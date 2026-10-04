# STEP -> per-prototype triangle meshes (inches, CAD frame: Y up) + instance list, saved to proto.pkl
import sys, time, pickle, re, numpy as np
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ColorType
from OCP.TDF import TDF_Label
from OCP.collections import Sequence_TDF_Label as LSeq
from OCP.TDataStd import TDataStd_Name
from OCP.Quantity import Quantity_Color
from OCP.TopLoc import TopLoc_Location
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
from OCP.BRep import BRep_Tool
from OCP.TopoDS import TopoDS
from OCP.XCAFApp import XCAFApp_Application
from OCP.IFSelect import IFSelect_RetDone

t0 = time.time()
app = XCAFApp_Application.GetApplication_s()
doc = TDocStd_Document(TCollection_ExtendedString("XmlXCAF")); app.InitDocument(doc)
r = STEPCAFControl_Reader(); r.SetColorMode(True); r.SetNameMode(True)
assert r.ReadFile(sys.argv[1]) == IFSelect_RetDone
r.Transfer(doc)
ST = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main()); CT = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
print('loaded', round(time.time() - t0, 1), flush=True)

def name(l):
    a = TDataStd_Name()
    return a.Get().ToExtString() if l.FindAttribute(TDataStd_Name.GetID_s(), a) else '?'
def lcolor(l):
    c = Quantity_Color()
    for t in (XCAFDoc_ColorType.XCAFDoc_ColorSurf, XCAFDoc_ColorType.XCAFDoc_ColorGen):
        if CT.GetColor_s(l, t, c): return (c.Red(), c.Green(), c.Blue())
    return None
def scolor(s):
    c = Quantity_Color()
    for t in (XCAFDoc_ColorType.XCAFDoc_ColorSurf, XCAFDoc_ColorType.XCAFDoc_ColorGen):
        try:
            if CT.GetColor(s, t, c): return (c.Red(), c.Green(), c.Blue())
        except TypeError:
            return None
    return None
def trsf_mat(loc):
    T = loc.Transformation()
    M = np.eye(4)
    for i in range(3):
        for j in range(4): M[i, j] = T.Value(i + 1, j + 1)
    return M

SKIP = re.compile(r'(screw|fhts|nut\b|washer|pop rivet|rivnut|bolt|pin\b|pins\b|bearing|spacer|cable tie|plug|clip|strap|damper|under tile|pollen|nectar|am-2579|detent|ring: first|body: first)', re.I)
insts = []   # (path, proto_key, M)
protos = {}  # key -> label
def walk(l, loc, path):
    if ST.IsAssembly_s(l):
        comps = LSeq(); ST.GetComponents_s(l, comps)
        for i in range(1, comps.Length() + 1):
            c = comps.Value(i); ref = TDF_Label(); ST.GetReferredShape_s(c, ref)
            walk(ref, loc.Multiplied(ST.GetLocation_s(c)), path + [name(c)])
    else:
        key = l.Tag() if hasattr(l, 'Tag') else id(l)
        k = str(key) + ':' + name(l)
        protos.setdefault(k, l)
        insts.append((path, k, trsf_mat(loc), lcolor(l)))
roots = LSeq(); ST.GetFreeShapes(roots)
walk(roots.Value(1), TopLoc_Location(), [])
print('instances', len(insts), 'protos', len(protos), flush=True)

keep = [it for it in insts if not SKIP.search(it[0][-1])]
print('kept instances', len(keep), flush=True)
need = sorted(set(it[1] for it in keep))
mesh = {}
LIN = float(sys.argv[2]) if len(sys.argv) > 2 else 0.35   # mm
ANG = float(sys.argv[3]) if len(sys.argv) > 3 else 0.35   # rad
ntri = 0
for k in need:
    l = protos[k]; shp = ST.GetShape_s(l)
    BRepMesh_IncrementalMesh(shp, LIN, False, ANG, True)
    base = lcolor(l)
    P, N, I, C = [], [], [], []
    off = 0
    ex = TopExp_Explorer(shp, TopAbs_FACE)
    while ex.More():
        f = TopoDS.Face(ex.Current()); ex.Next()
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(f, loc)
        if tri is None: continue
        n = tri.NbNodes(); m = tri.NbTriangles()
        tr = loc.Transformation()
        pts = np.empty((n, 3))
        for i in range(1, n + 1):
            p = tri.Node(i).Transformed(tr); pts[i - 1] = (p.X(), p.Y(), p.Z())
        ids = np.empty((m, 3), np.int64)
        for i in range(1, m + 1):
            a, b, c = tri.Triangle(i).Get(); ids[i - 1] = (a - 1, b - 1, c - 1)
        if f.Orientation() == TopAbs_REVERSED: ids = ids[:, [0, 2, 1]]
        fc = scolor(f) or base or (0.6, 0.6, 0.6)
        P.append(pts); I.append(ids + off); C.append(np.tile(np.array(fc, np.float32), (m, 1)))
        off += n
    if not P: continue
    P = np.concatenate(P) / 25.4; I = np.concatenate(I); C = np.concatenate(C)
    mesh[k] = (P.astype(np.float64), I.astype(np.int32), C)
    ntri += len(I) * sum(1 for it in keep if it[1] == k)
print('meshed', len(mesh), 'protos; total instanced triangles', ntri, round(time.time() - t0, 1), 's', flush=True)
pickle.dump({'insts': keep, 'mesh': mesh}, open('/home/claude/fieldcad/proto.pkl', 'wb'))
# triangle count by leaf name (instanced)
from collections import Counter
cnt = Counter()
for it in keep:
    if it[1] in mesh: cnt[it[0][-1].split(' <')[0][:60]] += len(mesh[it[1]][1])
for n, c in cnt.most_common(45): print(f'{c:8d}  {n}')
