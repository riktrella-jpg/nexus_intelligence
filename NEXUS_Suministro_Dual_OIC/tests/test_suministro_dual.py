"""Validación reproducible con casos sintéticos, no con datos reales identificables."""
from __future__ import annotations
import hashlib
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from app.oic.motor_suministro import review_file,get_sheets,RULE_CODES,load_catalog

SOURCE=ROOT/'tests/casos_control_dual.xlsx'
NS='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def cells(zipf, sheet):
    xml=ET.fromstring(zipf.read(dict(get_sheets(zipf))[sheet]))
    return {c.get('r'):c for c in xml.iter(NS+'c')}


def value(cell):
    return ''.join(x.text or '' for x in cell.iter(NS+'t'))


def yellow(zipf,cell):
    sid=int(cell.get('s','0'))
    styles=ET.fromstring(zipf.read('xl/styles.xml'))
    xfs=styles.find(NS+'cellXfs')
    fills=styles.find(NS+'fills')
    fill_id=int(xfs[sid].get('fillId','0'))
    fg=fills[fill_id].find('.//'+NS+'fgColor')
    return fg is not None and fg.get('rgb','').upper()=='FFFFFF00'


class DualEngineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        cls.dest=Path(cls.temp.name)/'dual.xlsx'
        cls.result=review_file(SOURCE,cls.dest,'2026-10-31')

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_both_types_in_same_sheet(self):
        self.assertEqual(self.result['registros'],6)
        self.assertEqual(self.result['por_tipo']['MEDICAMENTOS']['registros'],2)
        self.assertEqual(self.result['por_tipo']['MATERIAL DE CURACIÓN']['registros'],4)
        self.assertEqual(sum(self.result.get(x,0) for x in ('errores','revisar','informativos','ok')),6)

    def test_four_sheets_and_ooxml_valid(self):
        with zipfile.ZipFile(self.dest) as z:
            self.assertIsNone(z.testzip())
            names=[name for name,_ in get_sheets(z)]
            self.assertIn('base',names)
            self.assertIn('REVISION OIC',names)
            self.assertIn('OBSERVACIONES OIC',names)
            self.assertIn('RESUMEN OIC',names)
            for f in z.namelist():
                if f.endswith(('.xml','.rels')) or f=='[Content_Types].xml':
                    ET.fromstring(z.read(f))

    def test_original_sheet_byte_identical(self):
        with zipfile.ZipFile(SOURCE) as a,zipfile.ZipFile(self.dest) as b:
            for name,source in get_sheets(a):
                target=dict(get_sheets(b))[name]
                self.assertEqual(hashlib.sha256(a.read(source)).digest(),
                                 hashlib.sha256(b.read(target)).digest())

    def test_17_ae_au_columns_written(self):
        with zipfile.ZipFile(self.dest) as z:
            cv=cells(z,'REVISION OIC')
            for code in RULE_CODES:
                self.assertIn(code+'2',cv)
            self.assertEqual(value(cv['AV6']),'ERROR')
            self.assertIn('INICIO POSTERIOR',value(cv['AG6']))

    def test_iva_information_only_not_yellow(self):
        with zipfile.ZipFile(self.dest) as z:
            cv=cells(z,'REVISION OIC')
            self.assertIn('INFORMATIVO',value(cv['AL3']))
            self.assertEqual(value(cv['AV3']),'INFORMATIVO')
            for address in ('P3','S3','T3','U3','AC3','AL3','AN3'):
                self.assertFalse(yellow(z,cv[address]),address)

    def test_no_false_duplicate_when_cnis_missing(self):
        with zipfile.ZipFile(self.dest) as z:
            cv=cells(z,'REVISION OIC')
            for address in ('AM4','AM5','AS4','AS5'):
                self.assertEqual(value(cv[address]),'OK',address)

    def test_yellow_exact_fields_on_errors_and_reviews(self):
        with zipfile.ZipFile(self.dest) as z:
            cv=cells(z,'REVISION OIC')
            for address in ('Q4','AE4','P4','S4','T4','AL4','AV4',
                            'N6','O6','AG6','V6','AY6','V7','AY7'):
                self.assertTrue(yellow(z,cv[address]),address)
            self.assertFalse(yellow(z,cv['B4']),'B4 unaffected')

    def test_category_filter(self):
        with tempfile.TemporaryDirectory() as tmp:
            for mode,expected in [('medicamentos',2),('material_curacion',4)]:
                output=Path(tmp)/(mode+'.xlsx')
                summary=review_file(SOURCE,output,'2026-10-31',modo=mode)
                self.assertEqual(summary['registros'],expected)
                self.assertTrue(output.is_file())

    def test_invalid_mode_and_no_overwrite(self):
        with self.assertRaisesRegex(ValueError,'sobrescribir'):
            review_file(SOURCE,SOURCE,'2026-10-31')
        with self.assertRaisesRegex(ValueError,'modo'):
            review_file(SOURCE,self.dest,'2026-10-31',modo='otro')


if __name__=='__main__':unittest.main(verbosity=2)
