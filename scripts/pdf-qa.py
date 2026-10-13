import json, pathlib, subprocess
from pypdf import PdfReader
import pypdfium2 as pdfium
folder=pathlib.Path('execution')
target=folder/'browser-resident-demo.pdf'
reader=PdfReader(target)
text='\n'.join(page.extract_text() or '' for page in reader.pages)
assert len(reader.pages)==1
assert 'DEMO / NOT OFFICIAL' in text
assert 'Permanent resident certificate' in text
assert sum(0x980<=ord(c)<=0x9ff for c in text)>100
(folder/'pdf-extracted-text.txt').write_text(text,encoding='utf8')
doc=pdfium.PdfDocument(target)
page=doc[0]
image=page.render(scale=2.0).to_pil()
image.save(folder/'browser-resident-demo.png')
fonts=[]
for page in reader.pages:
    for font in page['/Resources']['/Font'].get_object().values():
        fonts.append(str(font.get_object().get('/BaseFont')))
summary={'pages':len(reader.pages),'banglaCodepoints':sum(0x980<=ord(c)<=0x9ff for c in text),'fonts':fonts,'visualQa':'See rendered PNG. Copy/text extraction of some Bengali ligatures is imperfect with current Nirmala/Chromium PDF mapping.'}
case=json.loads((folder/'resident-language-case.json').read_text(encoding='utf8'))
variants=[]
for variant in case['templates']:
    artifact=pathlib.Path(variant['artifact'])
    pdf=PdfReader(artifact)
    content='\n'.join(p.extract_text() or '' for p in pdf.pages)
    assert len(pdf.pages)==1
    assert 'DEMO / NOT OFFICIAL' in content
    language=variant['language']
    if language!='bn':
        assert f"Template {variant['templateVersion']}" in content
        assert case['purposeEn'] in content and case['residenceSince'] in content
        assert 'Permanent resident certificate' in content
    else:
        assert case['purposeEn'] not in content and 'Permanent resident certificate' not in content
    if language!='en':assert case['residenceSinceBn'] in content
    else:assert case['residenceSinceBn'] not in content
    rendered=pdfium.PdfDocument(artifact)[0].render(scale=1.5).to_pil()
    rendered.save(artifact.with_suffix('.png'))
    variants.append({'language':language,'pages':len(pdf.pages),'templateVersion':variant['templateVersion'],'expectedApprovedValuesAndLanguage':True,'banglaCodepoints':sum(0x980<=ord(c)<=0x9ff for c in content)})
summary['languageVariants']=variants
(folder/'pdf-qa.json').write_text(json.dumps(summary,indent=2),encoding='utf8')
print(json.dumps(summary))

expanded=[]
for name in ['service-1-expanded-demo','service-2-expanded-demo','service-42-expanded-demo','trade-renewal-demo','biodata-copy-demo','holding-copy-demo','witness-copy-demo','credit-report-demo','sandbox-invoice-demo']:
    source=folder/(name+'.pdf')
    pdf=PdfReader(source)
    content='\n'.join(p.extract_text() or '' for p in pdf.pages)
    assert 'DEMO / NOT OFFICIAL' in content
    document=pdfium.PdfDocument(source)
    for index in range(len(document)):
        document[index].render(scale=1.4).to_pil().save(folder/(name+f'-page{index+1}.png'))
    expanded.append({'file':source.name,'pages':len(pdf.pages),'demoWatermark':True,'extractedCharacters':len(content)})
(folder/'expanded-pdf-qa.json').write_text(json.dumps(expanded,indent=2),encoding='utf8')
print(json.dumps(expanded))
