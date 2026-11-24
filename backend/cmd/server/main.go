package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/ersincebi/titanview/backend/internal/access"
	"github.com/ersincebi/titanview/backend/internal/app"
	"github.com/ersincebi/titanview/backend/internal/desktop"
	"github.com/ersincebi/titanview/backend/internal/remote"
)

func main() {
	port := flag.Int("port", 8080, "HTTP & WebSocket server port")
	dbPath := flag.String("db", "data/titanview.db", "Path to SQLite database file")
	staticDir := flag.String("static", "dist", "Path to built frontend static directory")
	pollSec := flag.Int("yahoo-poll", 15, "Yahoo Finance BIST/US polling interval in seconds")
	collectMin := flag.Int("collect-interval", 15, "Background favourites candle collection interval in minutes (0 = off)")
	addr := flag.String("addr", "", "Listen address (overrides -port), e.g. 127.0.0.1:0 for a random free loopback port")
	desktopMode := flag.Bool("desktop", false, "Tauri sidecar mode: require TITAN_DESKTOP_TOKEN, CORS only for Tauri origins, no static files, print TITAN_LISTEN=<addr>")
	remoteMode := flag.Bool("remote", false, "Remote server mode (phones/other computers): persistent token (TITAN_REMOTE_TOKEN or <db dir>/remote_token), CORS for Tauri origins, login page for browsers")
	remoteRotate := flag.Bool("remote-rotate", false, "Generate a new remote token (unpairs every device), print the pair URI and exit")
	publicURL := flag.String("public-url", "", "Address phones use to reach this server (for the pair URI), e.g. https://titan.example.com")
	stdinEOF := flag.Bool("exit-on-stdin-eof", false, "Shut down when stdin closes (parent process gone)")
	healthcheck := flag.Bool("healthcheck", false, "Probe http://127.0.0.1:<port>/healthz and exit 0 (healthy) or 1 (container HEALTHCHECK)")
	unofficialFlag := flag.Bool("unofficial-sources", false, "Override unofficial third-party sources (Yahoo Finance, Google News, İş Yatırım); overrides saved setting and TITAN_UNOFFICIAL_SOURCES")
	flag.Parse()
	var unofficialOverride *bool
	flag.Visit(func(f *flag.Flag) {
		if f.Name == "unofficial-sources" {
			v := *unofficialFlag
			unofficialOverride = &v
		}
	})
	if *healthcheck {
		c := &http.Client{Timeout: 3 * time.Second}
		resp, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d/healthz", *port))
		if err != nil || resp.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		os.Exit(0)
	}
	if *desktopMode && *remoteMode {
		log.Fatalf("-desktop and -remote are mutually exclusive")
	}
	listenAddr := *addr
	if listenAddr == "" {
		listenAddr = fmt.Sprintf(":%d", *port)
	}
	dataDir := filepath.Dir(*dbPath)
	pairBase := strings.TrimSpace(*publicURL)
	if pairBase == "" {
		pairBase = strings.TrimSpace(os.Getenv("TITAN_PUBLIC_URL"))
	}
	if *remoteRotate {
		tok, err := remote.RotateToken(dataDir)
		if err != nil {
			log.Fatalf("remote token: %v", err)
		}
		printPair(pairBase, listenAddr, tok)
		return
	}

	// Cloudflare Access (defence in depth behind a tunnel): enforced when both variables are set.
	accessCfg := access.Config{
		Team:   strings.TrimSpace(os.Getenv("CF_ACCESS_TEAM")),
		AUD:    strings.TrimSpace(os.Getenv("CF_ACCESS_AUD")),
		Emails: access.ParseEmails(os.Getenv("CF_ACCESS_EMAILS")),
	}
	if err := accessCfg.Validate(); err != nil {
		log.Fatalf("Cloudflare Access config: %v", err)
	}
	var verifier *access.Verifier
	if accessCfg.Enabled() {
		verifier = access.New(accessCfg)
		log.Printf("🔐 Cloudflare Access enforced for team %q", accessCfg.Team)
	}

	var outer func(http.Handler) http.Handler
	switch {
	case *desktopMode:
		token := strings.TrimSpace(os.Getenv("TITAN_DESKTOP_TOKEN"))
		if token == "" {
			log.Fatalf("desktop mode needs TITAN_DESKTOP_TOKEN")
		}
		outer = func(h http.Handler) http.Handler { return desktop.Middleware(token, h) }
	case *remoteMode:
		token := strings.TrimSpace(os.Getenv("TITAN_REMOTE_TOKEN"))
		if token != "" {
			if err := remote.ValidateToken(token); err != nil {
				log.Fatalf("TITAN_REMOTE_TOKEN: %v", err)
			}
		} else {
			var err error
			if token, err = remote.LoadOrCreateToken(dataDir); err != nil {
				log.Fatalf("remote token: %v", err)
			}
		}
		static := *staticDir != ""
		outer = func(h http.Handler) http.Handler { return remote.Middleware(token, h, remote.Options{Static: static}) }
		log.Printf("📱 remote mode: token required on every API call")
		printPair(pairBase, listenAddr, token)
	case !accessCfg.Enabled():
		log.Printf("⚠️  no access control (local development only; use -remote to expose this server)")
	}

	static := *staticDir
	if *desktopMode {
		static = "" // the Tauri shell serves dist/ itself
	}
	a, err := app.New(app.Config{
		DBPath:            *dbPath,
		StaticDir:         static,
		Addr:              listenAddr,
		PollEvery:         time.Duration(*pollSec) * time.Second,
		CollectEvery:      time.Duration(*collectMin) * time.Minute,
		PushSubject:       strings.TrimSpace(os.Getenv("VAPID_SUBJECT")),
		UnofficialSources: unofficialOverride,
		Wrap: func(h http.Handler) http.Handler {
			h = access.Middleware(verifier, h)
			if outer != nil {
				h = outer(h)
			}
			return h
		},
	})
	if err != nil {
		log.Fatalf("%v", err)
	}
	bound, err := a.Start()
	if err != nil {
		log.Fatalf("%v", err)
	}
	if *desktopMode {
		// The shell parses this exact line from stdout to learn the random port.
		fmt.Println(desktop.ListenLine(bound))
	}
	log.Printf("🚀 TitanView server listening on http://%s (db %s)", bound, *dbPath)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	if *stdinEOF {
		desktop.WatchStdin(os.Stdin, func() {
			log.Printf("stdin closed: parent gone, shutting down")
			stop <- syscall.SIGTERM
		})
	}
	<-stop
	if err := a.Stop(5 * time.Second); err != nil {
		log.Printf("shutdown: %v", err)
	}
	log.Printf("server stopped")
}

// printPair prints the pair URI to stderr only (never to logs shipped elsewhere).
func printPair(base, listen, token string) {
	if base == "" {
		host := listen
		if strings.HasPrefix(host, ":") {
			host = "<bu-makinenin-adresi>" + host
		}
		base = "http://" + host
	}
	fmt.Fprintf(os.Stderr, "\nTitanView eşleştirme (telefonda Ayarlar → Sunucu → Eşleştirme bağlantısı):\n  %s\n\n", remote.PairURI(base, token))
}
