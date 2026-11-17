"""Значок head-сессии: синий круг с белой обводкой, внутри белая оргсхема
(узел сверху, два снизу). Рисуется в 256 px и сжимается в кадры .ico.

    python3 icons/head-badge.py   # пишет icons/head-badge.ico рядом

Нужен Pillow. Рисунок свой, без чужих наборов.
"""
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
BIG = 256
BLUE = (16, 82, 170, 255)
WHITE = (255, 255, 255, 255)
# 16/20/24 — значок на кнопке панели задач (SM_CXSMICON при 100–150 %),
# 32/48/64/256 — режим headMode: icon, где значок и есть иконка окна.
SIZES = [(16, 16), (20, 20), (24, 24), (32, 32), (48, 48), (64, 64), (256, 256)]


def draw():
    im = Image.new('RGBA', (BIG, BIG), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # белая обводка ~1 px в кадре 16
    d.ellipse((0, 0, BIG - 1, BIG - 1), fill=WHITE)
    d.ellipse((18, 18, BIG - 19, BIG - 19), fill=BLUE)
    lw = 18
    d.line((128, 100, 128, 132), fill=WHITE, width=lw)
    d.line((80, 132, 176, 132), fill=WHITE, width=lw)
    d.line((80, 132, 80, 160), fill=WHITE, width=lw)
    d.line((176, 132, 176, 160), fill=WHITE, width=lw)
    d.ellipse((128 - 34, 52, 128 + 34, 120), fill=WHITE)
    d.ellipse((80 - 30, 150, 80 + 30, 210), fill=WHITE)
    d.ellipse((176 - 30, 150, 176 + 30, 210), fill=WHITE)
    return im


if __name__ == '__main__':
    im = draw()
    im.save(HERE / 'head-badge.ico', sizes=SIZES)
