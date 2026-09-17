from pathlib import Path
import sys
from PIL import Image

root = Path(sys.argv[1]).resolve()
image = Image.open(root / 'logo.png').convert('RGBA')
# Remove transparent margins, retaining the supplied artwork and aspect ratio.
bounds = image.getchannel('A').getbbox()
if bounds:
    image = image.crop(bounds)
image.thumbnail((240, 240), Image.Resampling.LANCZOS)
canvas = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
canvas.alpha_composite(image, ((256-image.width)//2, (256-image.height)//2))
(root / 'build').mkdir(exist_ok=True)
canvas.save(root / 'build' / 'icon.png')
canvas.save(root / 'build' / 'icon.ico', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
print(root / 'build' / 'icon.ico')
