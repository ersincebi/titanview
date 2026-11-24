cask "titanview" do
  arch arm: "aarch64", intel: "x64"

  version "1.0.2"
  sha256 arm:   "753d87f0ac5a78a55920edc04cf7315e17f0e98e56abeabf13599153fe381393",
         intel: "d00fc120c8899c4eb7ea60447a3102f65af14335b3e87257e93ff4a414bcd895"

  url "https://github.com/ersincebi/titanview/releases/download/v#{version}/TitanView_#{version}_#{arch}.dmg"
  name "TitanView"
  desc "Local-first charting and market analysis desktop app"
  homepage "https://github.com/ersincebi/titanview"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on :macos

  app "TitanView.app"

  zap trash: [
    "~/Library/Application Support/dev.titanview.desktop",
    "~/Library/Caches/dev.titanview.desktop",
    "~/Library/Logs/dev.titanview.desktop",
    "~/Library/Preferences/dev.titanview.desktop.plist",
    "~/Library/Saved Application State/dev.titanview.desktop.savedState",
    "~/Library/WebKit/dev.titanview.desktop",
  ]

  caveats <<~EOS
    TitanView is not yet notarized by Apple. If macOS blocks the first launch, run:
      xattr -dr com.apple.quarantine "#{appdir}/TitanView.app"
  EOS
end
