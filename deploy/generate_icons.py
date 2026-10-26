"""Render the existing code-native icon at the sizes required by installable apps."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / "static" / "icons"
root.mkdir(exist_ok=True)
for name, size in (("icon-192.png",192),("icon-512.png",512),("maskable-512.png",512),("apple-touch-icon.png",180)):
    scale = 4
    canvas = Image.new("RGB",(size*scale,size*scale),"#20221f")
    draw = ImageDraw.Draw(canvas)
    unit = size*scale/108
    pts = lambda values: [(round(x*unit),round(y*unit)) for x,y in values]
    stroke = round(3.5*unit)
    draw.line(pts([(30,72),(30,36),(78,36),(78,72),(30,72),(30,69),(44,52),(58,65),(69,54),(78,63)]), fill="#faf9f6",width=stroke,joint="curve")
    draw.ellipse((63*unit,40*unit,71*unit,48*unit),fill="#faf9f6")
    canvas.resize((size,size),Image.Resampling.LANCZOS).save(root/name)
print("App icons generated")
