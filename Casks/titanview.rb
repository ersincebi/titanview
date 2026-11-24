cask "titanview" do
  arch arm: "aarch64", intel: "x64"

  version "1.0.1"
  sha256 arm:   "8b5828b590837501d828641f8dad6798340a80af3f3a7dc66465aa3a55c46de8",
         intel: "8aae446c740de8c36c647639028406439cd0d81972eb47ea7efb530740fc0ae1"

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
