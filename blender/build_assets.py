# Blender 4.2: modelliert Brett, Steine und Stecker, rendert Vergleichsbilder, exportiert GLB.
# Aufruf: blender -b -P blender/build_assets.py -- [--render] [--bake] [--export] [--samples N]
import bpy, bmesh, json, math, os, sys
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX = os.path.join(ROOT, 'tex')
L = json.load(open(os.path.join(ROOT, 'tools/layout.json')))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default
PREV = arg('--out', '/workspace/1001-previews')

bpy.ops.wm.read_factory_settings(use_empty=True)
import addon_utils
addon_utils.enable('cycles', default_set=True)
scene = bpy.context.scene

def hex2lin(h):
    h = h.lstrip('#'); c = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    return [((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c] + [1]

# ------------------------------------------------------------ Geometrie-Helfer
def rounded_rect_pts(w, h, r, seg=14):
    pts = []
    for (cx, cy, a0) in ((w/2-r, h/2-r, 0), (-w/2+r, h/2-r, 90), (-w/2+r, -h/2+r, 180), (w/2-r, -h/2+r, 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

def slab(name, w, h, t, r, bevel_top, bevel_bot, seg=14, bev_seg=6):
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, 0)) for (x, y) in rounded_rect_pts(w, h, r, seg)]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    top_verts = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=top_verts, vec=(0, 0, t))
    bm.normal_update()
    # untere Flaeche zeigt nach unten (Extrusion dreht sie nicht automatisch)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    top_edges = [e for e in bm.edges if all(v.co.z > t - 1e-5 for v in e.verts) and not e.is_boundary and len(e.link_faces) == 2 and any(abs(fc.normal.z) < 0.5 for fc in e.link_faces)]
    bmesh.ops.bevel(bm, geom=top_edges, offset=bevel_top, segments=bev_seg, profile=0.5, affect='EDGES', clamp_overlap=True)
    if bevel_bot > 0:
        bot_edges = [e for e in bm.edges if all(v.co.z < 1e-5 for v in e.verts) and any(abs(fc.normal.z) < 0.5 for fc in e.link_faces)]
        bmesh.ops.bevel(bm, geom=bot_edges, offset=bevel_bot, segments=max(2, bev_seg // 2), profile=0.5, affect='EDGES', clamp_overlap=True)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    for p in me.polygons: p.use_smooth = True
    return ob

def add_smooth_by_angle(ob, deg=40):
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(deg), keep_sharp_edges=True)
    ob.select_set(False)

def planar_uv(ob, w, h, ox=0.0, oy=0.0, cond=None, fallback=None, name='UVMap'):
    me = ob.data
    if not me.uv_layers: me.uv_layers.new(name=name)
    uv = me.uv_layers.active.data
    for p in me.polygons:
        use = cond(p) if cond else True
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if use: uv[li].uv = ((co.x - ox) / w + 0.5, (co.y - oy) / h + 0.5)
            elif fallback: uv[li].uv = fallback(co, p)

# ------------------------------------------------------------ Materialien
def img(name, colorspace='sRGB'):
    im = bpy.data.images.load(os.path.join(TEX, name), check_existing=True)
    im.colorspace_settings.name = colorspace
    return im

def principled(name, base=None, base_img=None, rough=0.5, rough_img=None, normal_img=None, normal_strength=1.0, coat=0.0, coat_rough=0.3, spec=0.5, sheen=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    if base_img:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = img(base_img); nt.links.new(t.outputs[0], b.inputs['Base Color'])
    elif base: b.inputs['Base Color'].default_value = hex2lin(base)
    if rough_img:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = img(rough_img, 'Non-Color'); nt.links.new(t.outputs[0], b.inputs['Roughness'])
    else: b.inputs['Roughness'].default_value = rough
    if normal_img:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = img(normal_img, 'Non-Color')
        n = nt.nodes.new('ShaderNodeNormalMap'); n.inputs['Strength'].default_value = normal_strength
        nt.links.new(t.outputs[0], n.inputs['Color']); nt.links.new(n.outputs[0], b.inputs['Normal'])
    b.inputs['Coat Weight'].default_value = coat
    b.inputs['Coat Roughness'].default_value = coat_rough
    b.inputs['Specular IOR Level'].default_value = spec
    b.inputs['Sheen Weight'].default_value = sheen
    return m

# ------------------------------------------------------------ Brett
W, D, T = L['boardW'], L['boardD'], L['boardT']
board = slab('Board', W, D, T, 0.32, 0.07, 0.03, seg=16, bev_seg=5)
board.location.z = -T  # Oberseite bei z=0
# Mulden der Punkteleiste (echte Geometrie, Boolean)
cutters = []
n = len(L['scores'])
for i in range(n):
    x = L['holeX0'] + (L['holeX1'] - L['holeX0']) * i / (n - 1)
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=L['holeR'], depth=0.4, location=(x, L['holeY'], 0.2 - L['holeDepth']))
    cutters.append(bpy.context.active_object)
bpy.ops.object.select_all(action='DESELECT')
for c in cutters: c.select_set(True)
bpy.context.view_layer.objects.active = cutters[0]
bpy.ops.object.join(); cutter = bpy.context.active_object; cutter.name = 'HoleCutter'
mod = board.modifiers.new('holes', 'BOOLEAN'); mod.operation = 'DIFFERENCE'; mod.object = cutter; mod.solver = 'EXACT'
bpy.context.view_layer.objects.active = board
bpy.ops.object.modifier_apply(modifier='holes')
bpy.data.objects.remove(cutter)
# Lochkanten weich: Bevel nur auf scharfen Kanten innerhalb der Leiste
bm = bmesh.new(); bm.from_mesh(board.data)
rim = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(60)
       and all(abs(v.co.y - L['holeY']) < L['holeR'] + 0.01 for v in e.verts) and all(abs(v.co.x) < L['holeX1'] + L['holeR'] + 0.05 for v in e.verts)
       and all(v.co.z > -1e-4 for v in e.verts)]
bmesh.ops.bevel(bm, geom=rim, offset=0.018, segments=3, profile=0.5, affect='EDGES', clamp_overlap=True)
bm.to_mesh(board.data); bm.free()
for p in board.data.polygons: p.use_smooth = True
add_smooth_by_angle(board, 35)

def is_top(p):
    c = p.center
    return c.z > -L['holeDepth'] - 0.01 and abs(c.x) < W / 2 - 0.08 and abs(c.y) < D / 2 - 0.08 and p.normal.z > -0.2
def side_uv(co, p):
    if abs(p.normal.x) > abs(p.normal.y): return (co.y / 6.0, co.z / 1.5 + 0.5)
    return (co.x / 6.0, co.z / 1.5 + 0.5)
planar_uv(board, W, D, cond=is_top, fallback=side_uv)
m_top = principled('BoardTop', base_img='board_albedo.jpg', rough_img='board_rough.jpg', normal_img='board_normal.jpg', normal_strength=0.6, spec=0.45, coat=0.08, coat_rough=0.35)
m_side = principled('BoardSide', base_img='board_side.jpg', rough=0.6, spec=0.4)
board.data.materials.append(m_top); board.data.materials.append(m_side)
for p in board.data.polygons: p.material_index = 0 if is_top(p) else 1

# ------------------------------------------------------------ Stein
TW, TH, TT = L['tileW'], L['tileH'], L['tileT']
def make_tile(name):
    ob = slab(name, TW, TH, TT, L['tileR'], L['tileBevel'], 0.035, seg=14, bev_seg=7)
    add_smooth_by_angle(ob, 40)
    planar_uv(ob, TW, TH, cond=lambda p: p.normal.z > -0.5, fallback=lambda co, p: (0.02, 0.02))
    return ob
tile_proto = make_tile('Tile')

def tile_material(card):
    suit = card[0]
    m = principled('Tile_' + card, base_img=f'tile_{card}.png', rough=0.46, normal_img='tile_normal.png', normal_strength=0.35, coat=0.22, coat_rough=0.42, spec=0.5, sheen=0.15)
    return m

# ------------------------------------------------------------ Stecker (Punktezaehler)
def make_peg(name, color):
    prof = [(0.0, 0.0), (0.2, 0.0), (0.205, 0.02), (0.2, 0.05), (0.13, 0.14), (0.105, 0.28), (0.12, 0.36), (0.15, 0.42), (0.155, 0.47), (0.13, 0.53), (0.07, 0.565), (0.0, 0.575)]
    bm = bmesh.new(); segs = 48
    rings = []
    for (r, z) in prof:
        ring = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
        rings.append(ring)
    for a, b in zip(rings[:-1], rings[1:]):
        for i in range(segs):
            bm.faces.new((a[i], a[(i+1) % segs], b[(i+1) % segs], b[i]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    for p in me.polygons: p.use_smooth = True
    ob.data.materials.append(principled('Peg_' + name, base=color, rough=0.42, coat=0.3, coat_rough=0.35, sheen=0.1))
    ob.scale = (0.5, 0.5, 0.5)
    return ob
peg_h = make_peg('PegHuman', L['colors']['H'])
peg_c = make_peg('PegComputer', '#2c2c2c')

# ------------------------------------------------------------ Szene (Vergleich mit Referenz)
def cell_center(col, row):
    x0 = -L['cols'] / 2; y0 = -D / 2 + L['marginBottom']
    return (x0 + col + 0.5, y0 + row + 0.5)

placed = []
def place(card, col, row, rot=0.0, dx=0.0, dy=0.0, proto=tile_proto):
    ob = proto.copy(); ob.data = proto.data.copy(); scene.collection.objects.link(ob)
    ob.data.materials.clear(); ob.data.materials.append(tile_material(card))
    x, y = cell_center(col, row); ob.location = (x + dx, y + dy, 0.0); ob.rotation_euler.z = math.radians(rot)
    placed.append(ob); return ob

def hero_layout():
    place('HA', 1, 5, 0.5); place('H9', 2, 5, -0.3, dy=0.03); place('HK', 3, 5, 1.0, dy=0.06)
    place('DQ', 7, 2, -1.5); place('CJ', 8, 2, 2.0, dy=0.05); place('S10', 7, 1, 0.5, dx=0.12, dy=-0.02)

def setup_world_and_light():
    world = bpy.data.worlds.new('World'); scene.world = world; world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    sky = world.node_tree.nodes.new('ShaderNodeTexSky'); sky.sky_type = 'NISHITA'
    sky.sun_elevation = math.radians(48); sky.sun_rotation = math.radians(140); sky.sun_disc = False
    sky.air_density = 1.2; sky.dust_density = 2.0
    mix = world.node_tree.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.inputs[0].default_value = 0.75
    mix.inputs[6].default_value = (1.0, 0.94, 0.86, 1)
    world.node_tree.links.new(sky.outputs[0], mix.inputs[7])
    world.node_tree.links.new(mix.outputs[2], bg.inputs[0])
    bg.inputs[1].default_value = float(arg('--world', 0.35))
    # weiches Tageslicht von links hinten
    sun = bpy.data.lights.new('Sun', 'SUN'); sun.energy = float(arg('--sun', 2.6)); sun.angle = math.radians(14); sun.color = (1.0, 0.96, 0.9)
    so = bpy.data.objects.new('Sun', sun); scene.collection.objects.link(so)
    so.rotation_euler = (math.radians(42), 0, math.radians(-128))
    # grosse Flaechenleuchte als Fensterlicht
    al = bpy.data.lights.new('Window', 'AREA'); al.shape = 'RECTANGLE'; al.size = 14; al.size_y = 8; al.energy = float(arg('--area', 500)); al.color = (1.0, 0.97, 0.93)
    ao = bpy.data.objects.new('Window', al); scene.collection.objects.link(ao)
    ao.location = (-10, 9, 14); ao.rotation_euler = (math.radians(-35), math.radians(-35), 0)
    # Tisch
    bpy.ops.mesh.primitive_plane_add(size=120, location=(0, 0, -T - 0.001))
    table = bpy.context.active_object; table.name = 'Table'
    table.data.materials.append(principled('Table', base='#efe3d3', rough=0.85, spec=0.3))

def setup_camera(view='hero'):
    cam = bpy.data.cameras.new('Cam'); co = bpy.data.objects.new('Cam', cam); scene.collection.objects.link(co); scene.camera = co
    cam.lens = float(arg('--lens', 32)); cam.sensor_width = 36
    if view == 'hero':
        co.location = Vector((float(arg('--px', 1.6)), float(arg('--py', -13.2)), float(arg('--pz', 15.5))))
        target = Vector((float(arg('--tx', 1.3)), float(arg('--ty', -0.6)), 0))
    else:  # Nahaufnahme Steine
        co.location = Vector((3.2, -6.5, 4.0)); target = Vector((2.5, -3.6, 0.1)); cam.lens = 60
    d = target - co.location
    co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    co.rotation_euler.rotate_axis('Z', math.radians(float(arg('--roll', 0))))
    return co

def render(path, samples=96, res=(1152, 864)):
    scene.render.engine = 'CYCLES'; scene.cycles.device = 'CPU'
    scene.cycles.samples = samples; scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = res; scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = arg('--view', 'AgX'); scene.view_settings.look = arg('--look', 'AgX - Base Contrast') if arg('--view', 'AgX') == 'AgX' else 'None'
    scene.view_settings.exposure = float(arg('--exposure', 0.0))
    scene.render.filepath = path; bpy.ops.render.render(write_still=True)

if '--render' in argv or '--closeup' in argv:
    board.rotation_euler.z = math.radians(float(arg('--yaw', 2.5)))
    hero_layout()
    for ob in placed:  # mit dem Brett drehen
        ob.location = Matrix.Rotation(board.rotation_euler.z, 4, 'Z') @ ob.location
        ob.rotation_euler.z += board.rotation_euler.z
    ph = peg_h.copy(); scene.collection.objects.link(ph)
    ph.location = Matrix.Rotation(board.rotation_euler.z, 4, 'Z') @ Vector((L['holeX0'] + (L['holeX1'] - L['holeX0']) * 1 / 19, L['holeY'], -L['holeDepth']))
    pc = peg_c.copy(); scene.collection.objects.link(pc)
    pc.location = Matrix.Rotation(board.rotation_euler.z, 4, 'Z') @ Vector((-L['boxX'] - 0.25, L['holeY'], 0))
    peg_h.hide_render = peg_c.hide_render = tile_proto.hide_render = True
    setup_world_and_light()
    if '--render' in argv:
        setup_camera('hero'); render(os.path.join(PREV, arg('--name', 'blender_hero.png')), int(arg('--samples', 96)))
    if '--closeup' in argv:
        setup_camera('close'); render(os.path.join(PREV, 'blender_closeup.png'), int(arg('--samples', 96)), (1200, 900))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'blender', 'hero_scene.blend'))

if '--export' in argv:
    out = os.path.join(ROOT, 'public', 'assets'); os.makedirs(out, exist_ok=True)
    def export(objs, fn):
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs: o.hide_set(False); o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.export_scene.gltf(filepath=os.path.join(out, fn), export_format='GLB', use_selection=True, export_apply=True,
                                  export_yup=True, export_texcoords=True, export_normals=True, export_materials='EXPORT',
                                  export_image_format='AUTO', export_draco_mesh_compression_enable=False)
    tile_proto.location = (0, 0, 0); tile_proto.rotation_euler = (0, 0, 0)
    tile_proto.data.materials.clear(); tile_proto.data.materials.append(principled('TilePaint', base=L['colors']['H'], rough=0.46, coat=0.22, coat_rough=0.42, sheen=0.15))
    export([tile_proto], 'tile.glb')
    board.rotation_euler.z = 0
    export([board], 'board.glb')
    peg_h.location = (0, 0, 0); peg_c.location = (0, 0, 0)
    export([peg_h], 'peg_human.glb'); export([peg_c], 'peg_computer.glb')
    print('EXPORT OK')
