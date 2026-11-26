"""Значок coord-сессии (`^co-`): оранжевый круг с белой обводкой, внутри
белая четырёхлучевая звезда (роза ветров — тот, кто задаёт направление
нескольким head). Тот же размер и круг, что у head-badge.ico, другой цвет и
знак: на 16 px отличим от синей оргсхемы head. Рисуется в 256 px и
сжимается в кадры .ico.

    .venv/bin/python icons/coord-badge.py   # пишет icons/coord-badge.ico рядом

Нужен Pillow. Рисунок свой, без чужих наборов.
"""
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
BIG = 256
ORANGE = (222, 104, 0, 255)
WHITE = (255, 255, 255, 255)
# Кадры те же, что у head-badge.ico: 16/20/24 — значок на кнопке панели задач,
# 32–256 — на случай, если значок поставят иконкой окна.
SIZES = [(16, 16), (20, 20), (24, 24), (32, 32), (48, 48), (64, 64), (256, 256)]


def star(cx, cy, outer, inner):
    """Четыре луча по осям, между ними — впадины на радиусе inner."""
    pts = []
    for i in range(8):
        r = outer if i % 2 == 0 else inner
        # 0°, 45°, 90°… — лучи вверх/вправо/вниз/влево, впадины по диагоналям
        dx, dy = [(0, -1), (0.7071, -0.7071), (1, 0), (0.7071, 0.7071),
                  (0, 1), (-0.7071, 0.7071), (-1, 0), (-0.7071, -0.7071)][i]
        pts.append((cx + dx * r, cy + dy * r))
    return pts


def draw():
    im = Image.new('RGBA', (BIG, BIG), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # белая обводка ~1 px в кадре 16 — как у head-badge
    d.ellipse((0, 0, BIG - 1, BIG - 1), fill=WHITE)
    d.ellipse((18, 18, BIG - 19, BIG - 19), fill=ORANGE)
    d.polygon(star(128, 128, 92, 34), fill=WHITE)
    return im


if __name__ == '__main__':
    im = draw()
    im.save(HERE / 'coord-badge.ico', sizes=SIZES)
