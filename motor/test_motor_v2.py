import unittest
from decimal import Decimal as D
from motor_nexus_v2 import decidir_partida
class Tests(unittest.TestCase):
 def r(self, clave,monto,subtotal,iva='COINCIDE_DIRECTO',qty='1',precio='100'):
  return dict(partida=clave,monto=D(monto),subtotal=D(subtotal),cantidad=D(qty),precio=D(precio),iva=iva)
 def test_exact_duplication(self):
  a=self.r('a','100','100');c=decidir_partida([a,a,a]);self.assertEqual(len(c),1);self.assertEqual(c[0][1],D(100));self.assertEqual(len(c[0][0]),3)
 def test_two_distinct_amounts(self):
  c=decidir_partida([self.r('a','100','100'),self.r('a','200','200',qty='2')]);self.assertEqual(sum(t[1] for t in c),D(300))
 def test_iva(self):
  a=self.r('a','116','100','COMPATIBLE_IVA_16_NO_CONFIRMADO');self.assertEqual(decidir_partida([a])[0][1],D(116))
 def test_mismatch(self):
  a=self.r('a','400','100','NO_CONCILIADO');self.assertIsNone(decidir_partida([a])[0][1])
 def test_same_amount_two_keys(self):
  a=decidir_partida([self.r('a','100','100')])[0][1];b=decidir_partida([self.r('b','100','100')])[0][1];self.assertEqual(a+b,D(200))
if __name__=='__main__':unittest.main()
