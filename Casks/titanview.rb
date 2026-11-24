cask "titanview" do
  arch arm: "aarch64", intel: "x64"

  version "1.0.3"
  sha256 arm:   "573cc7391246927207b5026bc0e86731945e58853bf58f001902731b3efc4eb2",
         intel: "ec5de25897403289b03c0dcd73c82833bb42b3703d39dd9d8bbc726677f5729b"

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
