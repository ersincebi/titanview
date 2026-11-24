cask "titanview" do
  arch arm: "aarch64", intel: "x64"

  version "1.0.0"
  sha256 arm:   "ec46ef390ea3828fd12a8ed096491a091db7cb9fba83b675773d1d5adf8f5e21",
         intel: "aea237928a2d2dc3abf552d8594fe20098b12babf2ff0b5ad1dbbe380aa20928"

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
