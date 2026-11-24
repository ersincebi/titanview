cask "titanview" do
  arch arm: "aarch64", intel: "x64"

  version "1.0.0"
  sha256 arm:   "05761b976ef658a324f59ad79244f6fc775b35cd81856dbfad0a1585fe3cdcd1",
         intel: "8176419e9e10cf01880ab229a6b85e2a676130dfaece688526a9b5c58fd7ff41"

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
