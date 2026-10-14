"""Структурная проверка OOXML, независимо от браузерного ZIP-экспортера."""
from pathlib import Path
from zipfile import ZipFile
import sys
from docx import Document
from PIL import Image
from io import BytesIO
import os

qa = Path(sys.argv[1])
document = Document(qa / 'pdf-image.docx')
assert len(document.sections) == 4
for index, section in enumerate(document.sections):
    expected = (530, 360) if index % 2 else (360, 530)
    assert abs(section.page_width.pt - expected[0]) < 0.1
    assert abs(section.page_height.pt - expected[1]) < 0.1
    assert section.top_margin == section.left_margin == 0
with ZipFile(qa / 'pdf-image.docx') as archive:
    assert archive.testzip() is None
    for index in range(1, 5):
        image = Image.open(BytesIO(archive.read(f'word/media/page-{index}.png')))
        image.verify()
print('PASS Независимое чтение DOCX: 4 секции, размеры и 4 PNG, ZIP без повреждений')
if (qa / 'pdf-image-word.pdf').exists():
    from pdf2image import convert_from_path
    from PIL import ImageChops
    pages = convert_from_path(qa / 'pdf-image-word.pdf', dpi=150, poppler_path=os.environ.get('SIGN_POPPLER_PATH'))
    assert len(pages) == 4
    for index, image in enumerate(pages):
        r, g, b = image.convert('RGB').split()
        mask = ImageChops.multiply(ImageChops.subtract(b, r).point(lambda v: 255 if v > 50 else 0), ImageChops.subtract(b, g).point(lambda v: 255 if v > 40 else 0))
        mask = ImageChops.multiply(mask, r.point(lambda v: 255 if v < 100 else 0))
        box = mask.getbbox()
        assert box and mask.histogram()[255] > 200
        assert abs((box[0] + box[2]) / 2 / image.width - .4) < .055
        assert abs((box[1] + box[3]) / 2 / image.height - .65) < .035
        image.save(qa / f'converted-word-page-{index + 1}.png')
    print('PASS PDF из Microsoft Word: 4 страницы, подпись и координаты на каждой')
