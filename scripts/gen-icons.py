"""TitanView uygulama simgelerini üretir (public/icons/* ve src-tauri/icons/*).
Kullanım: python3 scripts/gen-icons.py
"""
from PIL import Image, ImageDraw
import os
import shutil
import subprocess
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PUBLIC_OUT = os.path.join(ROOT, 'public', 'icons')
TAURI_OUT = os.path.join(ROOT, 'src-tauri', 'icons')

# TitanView marka paleti: Derin obsidyen + Turkuaz Mavi (#0284C7 / #38BDF8) + Yükseliş Zümrüt (#089981)
BG_DARK = (11, 14, 20)        # #0B0E14
BG_MID = (18, 25, 39)         # #121927
BORDER = (2, 132, 199)        # #0284C7
CYAN_LIGHT = (56, 189, 248)   # #38BDF8
CYAN_MAIN = (2, 132, 199)     # #0284C7
EMERALD = (16, 185, 129)      # #10B981
WHITE = (244, 247, 251)       # #F4F7FB


def draw_icon(size: int, maskable: bool = False, square: bool = False) -> Image.Image:
    scale = 4 if size <= 256 else 2
    n = size * scale
    im = Image.new('RGBA', (n, n), BG_DARK + (255,))
    d = ImageDraw.Draw(im)

    # Hafif merkez parıltısı (derin lacivert-obsidyen radyal görünüm)
    for step in range(6, 0, -1):
        frac = step / 6.0
        rad = n * 0.48 * frac
        r = int(BG_DARK[0] + (BG_MID[0] - BG_DARK[0]) * (1 - frac * 0.7))
        g = int(BG_DARK[1] + (BG_MID[1] - BG_DARK[1]) * (1 - frac * 0.7))
        b = int(BG_DARK[2] + (BG_MID[2] - BG_DARK[2]) * (1 - frac * 0.7))
        cx, cy = n * 0.5, n * 0.42
        d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=(r, g, b, 255))

    if not maskable and not square:
        rad = n * 0.21
        mask = Image.new('L', (n, n), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, n - 1, n - 1], rad, fill=255)
        bg = Image.new('RGBA', (n, n), (0, 0, 0, 0))
        bg.paste(im, (0, 0), mask)
        im = bg
        d = ImageDraw.Draw(im)
        # İnce turkuaz-mavi dış çerçeve (maske içinde net hizalı)
        bw = max(2, int(n * 0.02))
        ins = int(n * 0.015)
        d.rounded_rectangle([ins, ins, n - 1 - ins, n - 1 - ins], rad - ins, outline=BORDER + (195,), width=bw)

    # Güvenli çizim alanı
    safe = 0.62 if maskable else 0.70
    box = n * safe
    ox = (n - box) / 2
    oy = (n - box) / 2

    def pt(ux: float, uy: float) -> tuple[float, float]:
        return (ox + box * ux, oy + box * uy)

    # 1) Üst yatay T-kanadı (sağda zümrüt nabız noktası için temiz boşluk bırakır)
    top_bar = [
        pt(0.08, 0.14),
        pt(0.76, 0.14),
        pt(0.71, 0.27),
        pt(0.15, 0.27),
    ]
    d.polygon(top_bar, fill=WHITE + (255,))

    # 2) Merkez T gövdesi → V sol bacağı (parlak turkuaz #38BDF8)
    left_blade = [
        pt(0.24, 0.34),
        pt(0.41, 0.34),
        pt(0.54, 0.74),
        pt(0.44, 0.88),
    ]
    d.polygon(left_blade, fill=CYAN_LIGHT + (255,))

    # 3) Yükselen V sağ kanadı (Titan Cerulean #0284C7 — yükselen grafik ivmesi)
    right_blade = [
        pt(0.44, 0.88),
        pt(0.56, 0.88),
        pt(0.86, 0.34),
        pt(0.69, 0.34),
    ]
    d.polygon(right_blade, fill=CYAN_MAIN + (255,))

    # 4) Sağ üstte yükseliş zümrüt işareti (canlı piyasa nabzı)
    dot_r = box * 0.072
    dx, dy = pt(0.86, 0.205)
    d.ellipse([dx - dot_r, dy - dot_r, dx + dot_r, dy + dot_r], fill=EMERALD + (255,))

    return im.resize((size, size), Image.LANCZOS)


LOGO_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect x="2" y="2" width="60" height="60" rx="13" fill="#0B0E14" stroke="#0284C7" stroke-width="2"/>
  <polygon points="12,16 44,16 41.5,22.5 15.5,22.5" fill="#F4F7FB"/>
  <polygon points="20,26 28,26 34,45 29,52" fill="#38BDF8"/>
  <polygon points="29,52 35,52 50,26 42,26" fill="#0284C7"/>
  <circle cx="49" cy="19.2" r="3.5" fill="#10B981"/>
</svg>
"""


def main() -> None:
    os.makedirs(PUBLIC_OUT, exist_ok=True)
    os.makedirs(TAURI_OUT, exist_ok=True)

    # Web / PWA icons
    draw_icon(192, maskable=False).save(os.path.join(PUBLIC_OUT, 'icon-192.png'))
    draw_icon(512, maskable=False).save(os.path.join(PUBLIC_OUT, 'icon-512.png'))
    draw_icon(512, maskable=True).save(os.path.join(PUBLIC_OUT, 'icon-maskable-512.png'))
    draw_icon(180, maskable=True).convert('RGB').save(os.path.join(PUBLIC_OUT, 'apple-touch-icon.png'))
    draw_icon(32, maskable=False).save(os.path.join(PUBLIC_OUT, 'favicon-32.png'))
    with open(os.path.join(PUBLIC_OUT, 'logo.svg'), 'w', encoding='utf-8') as f:
        f.write(LOGO_SVG)

    # Tauri desktop icons
    tauri_pngs = {
        '32x32.png': 32,
        '64x64.png': 64,
        '128x128.png': 128,
        '128x128@2x.png': 256,
        'icon.png': 1024,
        'StoreLogo.png': 50,
        'Square30x30Logo.png': 30,
        'Square44x44Logo.png': 44,
        'Square71x71Logo.png': 71,
        'Square89x89Logo.png': 89,
        'Square107x107Logo.png': 107,
        'Square142x142Logo.png': 142,
        'Square150x150Logo.png': 150,
        'Square284x284Logo.png': 284,
        'Square310x310Logo.png': 310,
    }
    base_1024 = draw_icon(1024, maskable=False)
    for name, sz in tauri_pngs.items():
        img = base_1024 if sz == 1024 else draw_icon(sz, maskable=False)
        img.save(os.path.join(TAURI_OUT, name))

    # Windows multi-size .ico
    base_1024.save(
        os.path.join(TAURI_OUT, 'icon.ico'),
        format='ICO',
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    # macOS .icns via iconutil if available
    if shutil.which('iconutil'):
        with tempfile.TemporaryDirectory() as tmp:
            iconset = os.path.join(tmp, 'TitanView.iconset')
            os.makedirs(iconset)
            for s in (16, 32, 128, 256, 512):
                draw_icon(s, False).save(os.path.join(iconset, f'icon_{s}x{s}.png'))
                draw_icon(s * 2, False).save(os.path.join(iconset, f'icon_{s}x{s}@2x.png'))
            subprocess.run(
                ['iconutil', '-c', 'icns', iconset, '-o', os.path.join(TAURI_OUT, 'icon.icns')],
                check=True,
            )

    print('TitanView icons generated in public/icons and src-tauri/icons')


if __name__ == '__main__':
    main()
