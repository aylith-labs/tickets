from pathlib import Path
from html.parser import HTMLParser
import unittest

ROOT = Path(__file__).resolve().parent / 'build'
class Document(HTMLParser):
    def __init__(self, text):
        super().__init__(); self.ids=[]; self.links=[]; self.canon=[]; self.feed(text)
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if 'id' in a: self.ids.append(a['id'])
        if tag=='a': self.links.append(a.get('href',''))
        if tag=='link' and a.get('rel')=='canonical': self.canon.append(a.get('href'))
class StaticArtifact(unittest.TestCase):
    def test_routes(self):
        html=(ROOT/'index.html').read_text(); self.assertEqual(html,(ROOT/'home/index.html').read_text())
        d=Document(html); self.assertEqual(d.canon,['https://tickets.aylith.com/home/']); self.assertEqual(len(d.ids),len(set(d.ids)))
        for href in d.links:
            if href.startswith('#'): self.assertIn(href[1:],d.ids)
        self.assertNotIn('@@PROMPT@@',html)
    def test_release_and_prompt(self):
        html=(ROOT/'index.html').read_text(); js=(ROOT/'site.js').read_text()
        self.assertIn('releases/download/v0.1.4/',html+js)
        self.assertIn('init --adapter folder',html)
        prompt=(ROOT/'example-prompt.txt').read_text(); self.assertIn('example-17',prompt); self.assertIn('/your/project',prompt)
        self.assertNotIn('/home/stevenp',html+js+prompt)
    def test_distribution(self):
        self.assertEqual((ROOT/'CNAME').read_text(),'tickets.aylith.com\n')
        self.assertTrue((ROOT/'.nojekyll').is_file())
        self.assertIn('prefers-reduced-motion',(ROOT/'site.css').read_text())
        self.assertEqual({p.name for p in ROOT.iterdir()},{'index.html','home','site.css','site.js','CNAME','robots.txt','sitemap.xml','example-prompt.txt','.nojekyll','favicon.svg'})
if __name__=='__main__': unittest.main()
