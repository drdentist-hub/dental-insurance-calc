"""
图标生成器 —— 肘边备急
一次生成两套资源：
  1) PWA 图标       -> dist/icon-192.png, icon-512.png, icon-maskable-512.png
  2) 安卓启动图标   -> android/app/src/main/res/mipmap-*/ic_launcher.png

用法（用 default venv 的解释器，只有它装了 Pillow）：
  "C:/Users/drqua/.workbuddy/binaries/python/envs/default/Scripts/python.exe" tools/make_icons.py
"""
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent

TOP = (2, 132, 199)      # #0284c7
BOT = (4, 100, 155)      # 渐变下沿
WHITE = (255, 255, 255, 255)


def draw_tooth(size: int, rounded: bool) -> Image.Image:
    """绘制「牙齿 + 医疗十字」图标；rounded=False 用于 maskable（不切圆角）"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 竖直渐变背景
    for y in range(size):
        t = y / (size - 1)
        d.line(
            [(0, y), (size, y)],
            fill=(
                int(TOP[0] + (BOT[0] - TOP[0]) * t),
                int(TOP[1] + (BOT[1] - TOP[1]) * t),
                int(TOP[2] + (BOT[2] - TOP[2]) * t),
                255,
            ),
        )

    if rounded:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, size - 1, size - 1], radius=int(size * 0.23), fill=255
        )
        img.putalpha(mask)
        d = ImageDraw.Draw(img)

    k = size / 100.0
    cx = 50 * k
    ct, cb, w = 26 * k, 64 * k, 17 * k

    # 齿冠
    d.rounded_rectangle([cx - w, ct, cx + w, cb], radius=int(14 * k), fill=WHITE)
    # 牙颈
    d.rectangle([cx - w * 0.55, cb - 8 * k, cx + w * 0.55, cb + 5 * k], fill=WHITE)
    # 双牙根
    for sgn in (-1, 1):
        d.polygon(
            [
                (cx + sgn * w * 0.55, cb - 2 * k),
                (cx + sgn * w * 0.06, cb - 2 * k),
                (cx + sgn * w * 0.30, cb + 17 * k),
                (cx + sgn * w * 0.80, cb + 11 * k),
            ],
            fill=WHITE,
        )
    # 医疗十字（镂空成背景色）
    t, arml, cy0 = 2.8 * k, 8.5 * k, ct + 19 * k
    d.rectangle([cx - t, cy0 - arml, cx + t, cy0 + arml], fill=BOT)
    d.rectangle([cx - arml, cy0 - t, cx + arml, cy0 + t], fill=BOT)

    return img


def render(size: int, rounded: bool, out: pathlib.Path):
    out.parent.mkdir(parents=True, exist_ok=True)
    # 4x 超采样后降采样，边缘更干净
    draw_tooth(size * 4, rounded).resize((size, size), Image.LANCZOS).save(out)
    print(f"  {out.relative_to(ROOT)}  {size}x{size}")


def main():
    print("PWA 图标：")
    render(192, True, ROOT / "dist" / "icon-192.png")
    render(512, True, ROOT / "dist" / "icon-512.png")
    render(512, False, ROOT / "dist" / "icon-maskable-512.png")

    print("安卓启动图标：")
    for dpi, size in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
        render(size, True, ROOT / "android" / "app" / "src" / "main" / "res" / f"mipmap-{dpi}" / "ic_launcher.png")


if __name__ == "__main__":
    main()
