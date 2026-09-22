"""Bake every vehicle into one GLB coordinate standard.

Standard: Y-up, front -Z, centered on X/Z, wheels on WHL0_H..WHL3_H,
origin on the ground. Sources live outside the repo (OPEN_SPEED_SOURCE),
outputs in assets/vehicles/.

ONLY=<id>   bake one catalog entry.
PREVIEW=1   draw the wheel marks to build/review/marks/<id>.png instead of exporting.
"""
import json
import math
import os
import re
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
# Raw sources are not committed; OPEN_SPEED_SOURCE overrides the default archive path.
SOURCE = Path(os.environ.get("OPEN_SPEED_SOURCE", Path.home() / "Dev" / "open-speed" / "build" / "source"))
VEHICLES = json.loads((ROOT / "src/data/vehicles.json").read_text())
# Satin car paint, matching the runtime clamp in VehicleView.satin().
PAINT_ROUGHNESS = 0.55


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_model(path: Path):
    bpy.ops.import_scene.gltf(filepath=str(path))
    return list(bpy.context.scene.objects)


def apply_world_transform(objects, rotation_z: float, scale: float):
    transform = Matrix.Rotation(rotation_z, 4, "Z") @ Matrix.Diagonal((scale, scale, scale, 1))
    matrices = [(obj, obj.matrix_world.copy()) for obj in objects]
    for obj, matrix in matrices:
        obj.parent = None
        obj.matrix_world = transform @ matrix
    bpy.context.view_layer.update()


def narrow(objects, factor: float):
    """Squeezes the car on X, the track axis, after it has been turned nose-forward.

    Image-to-3D reads a car's width off photographs that were framed for it, and it comes back
    around a fifth wider than the car it was drawn from - wide enough that the wheels sit outside
    the arches once the model is scaled to its wheelbase. Squeezing the whole body, wheels and all,
    keeps the hubs under the arches and the tyres in proportion."""
    if factor == 1:
        return
    squeeze = Matrix.Diagonal((factor, 1, 1, 1))
    for obj in objects:
        matrix = squeeze @ obj.matrix_world
        location = matrix.translation.copy()
        if obj.type == "MESH" and obj.data is not None:
            obj.data.transform(Matrix.Translation(-location) @ matrix)
        obj.matrix_world = Matrix.Translation(location)
    bpy.context.view_layer.update()


def bounds(objects):
    points = []
    for obj in objects:
        if obj.type != "MESH":
            continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not points:
        return Vector((-1, -1, -1)), Vector((1, 1, 1))
    return Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points))), Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))


def rename_wheels(objects):
    wheels = []
    for obj in objects:
        match = re.match(r"^WHL([0-3])_H(?:Mesh)?$", obj.name, re.I)
        if match:
            obj.name = f"WHL{match.group(1)}_H"
            wheels.append(obj)
    return wheels


def decimate(objects, ratio: float):
    """Collapse dense AI meshes to a game budget before the wheels are cut out."""
    for obj in objects:
        if obj.type != "MESH":
            continue
        modifier = obj.modifiers.new("game budget", "DECIMATE")
        modifier.ratio = ratio
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        print(f"{obj.name}: decimated to {len(obj.data.polygons)} faces")


# --- wheels ---------------------------------------------------------------------------------
#
# Image-to-3D returns the whole car as one shell, so the four wheels have to be lifted out of it
# before they can turn. Every attempt to find them - cylinders grown to fit, connected pieces
# voting, tyre-versus-paint by texture hue - got one car right and tore a fender off the next.
#
# So they are not found, they are marked. `model.wheels` in the catalog names one cylinder per
# axle in the source's own coordinates, and the bake does exactly what it says: the faces whose
# centre is inside the cylinder become the wheel, and those same faces are what the body gives up.
# Nothing outside a marked cylinder is ever touched, which is the whole point - a mark can be
# wrong, but it cannot take the bonnet with it.
#
# `ONLY=<id> PREVIEW=1 npm run models` draws the marks: red is what turns, and the hole it leaves.


def marked_wheels(marks, rotation_z: float):
    """The four marked cylinders in source space, front pair first.

    One mark per axle, mirrored. A car is symmetric about its centre line; the shell it is drawn
    on is not, and picking each side on its own left a pair of wheels centimetres apart in size
    and in where they sat. Mirroring one mark makes that impossible.
    """
    axle = "xyz".index(marks["axle"])
    assert axle in (0, 1), "the axle runs across the car; sources are Z-up"
    along = 1 - axle
    # Which way the nose points once `sourceRotationZ` has been applied: +Y in Blender is -Z in
    # glTF, which is the front of the car. A mark on the wrong end would otherwise steer the
    # rear wheels.
    facing = math.sin(rotation_z) if along == 0 else math.cos(rotation_z)
    cylinders = []
    for end in ("front", "rear"):
        mark = marks[end]
        nose = mark["along"] * facing > 0
        assert nose == (end == "front"), f"the {end} mark sits at the other end of the car"
        for side in (1, -1):
            centre = [0.0, 0.0, mark["height"]]
            centre[axle] = side * mark["across"]
            centre[along] = mark["along"]
            cylinders.append({"centre": Vector(centre), "radius": mark["radius"], "half": mark["width"] / 2, "axle": axle})
    return cylinders


def inside(mesh, cylinder):
    """The faces of `mesh` whose centre is inside the marked cylinder."""
    axle, centre, radius = cylinder["axle"], cylinder["centre"], cylinder["radius"]
    radial = [i for i in (0, 1, 2) if i != axle]
    picked = set()
    for face in mesh.polygons:
        point = face.center
        if abs(point[axle] - centre[axle]) > cylinder["half"]:
            continue
        if (point[radial[0]] - centre[radial[0]]) ** 2 + (point[radial[1]] - centre[radial[1]]) ** 2 < radius ** 2:
            picked.add(face.index)
    return picked


def keep_faces(mesh, faces):
    """Delete everything but `faces`, and the vertices left behind by it."""
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[face for face in bm.faces if face.index not in faces], context="FACES")
    bmesh.ops.delete(bm, geom=[vert for vert in bm.verts if not vert.link_faces], context="VERTS")
    bm.to_mesh(mesh)
    bm.free()


# How far a point may sit off the fitted circle and still count as tread.
OFF_TREAD = 0.06


def fit_circle(points):
    """Least-squares circle through `points`: x^2 + y^2 + Dx + Ey + F = 0."""
    n = len(points)
    sums = [sum(x for x, _ in points), sum(y for _, y in points)]
    sxx = sum(x * x for x, _ in points); syy = sum(y * y for _, y in points)
    sxy = sum(x * y for x, y in points); sr = sum(x * x + y * y for x, y in points)
    rows = [[sxx, sxy, sums[0], -sum(x * (x * x + y * y) for x, y in points)],
            [sxy, syy, sums[1], -sum(y * (x * x + y * y) for x, y in points)],
            [sums[0], sums[1], n, -sr]]
    for i in range(3):
        pivot = max(range(i, 3), key=lambda r: abs(rows[r][i]))
        rows[i], rows[pivot] = rows[pivot], rows[i]
        if abs(rows[i][i]) < 1e-12:
            return None
        for r in range(i + 1, 3):
            factor = rows[r][i] / rows[i][i]
            for c in range(i, 4):
                rows[r][c] -= factor * rows[i][c]
    v = [0.0, 0.0, 0.0]
    for i in (2, 1, 0):
        v[i] = (rows[i][3] - sum(rows[i][c] * v[c] for c in range(i + 1, 3))) / rows[i][i]
    x, y = -v[0] / 2, -v[1] / 2
    inside_root = x * x + y * y - v[2]
    return (x, y, inside_root ** .5) if inside_root > 0 else None


def tread_circle(points):
    """Where a tyre's tread really is: its centre and its radius.

    Not a bounding box. A handful of the faces the mark caught straddled its edge, and their far
    vertices reach centimetres past the tread; a box drawn round those moves the axle off centre
    and lifts the tyre off the road. So the tread is traced instead - the farthest point in each
    direction round the wheel - and a circle is fitted to it, twice, dropping whatever sits off
    the circle the first time round.
    """
    centre = ((min(x for x, _ in points) + max(x for x, _ in points)) / 2,
              (min(y for _, y in points) + max(y for _, y in points)) / 2)
    # Wide enough slices that each one holds a point from the tread even on a coarse wheel, since a
    # slice that only caught something from inside the rim would drag the circle off the tyre.
    slices = min(180, max(24, len(points) // 60))
    radius = tread = None
    for _ in range(4):
        ring = [None] * slices
        for x, y in points:
            dx, dy = x - centre[0], y - centre[1]
            reach = (dx * dx + dy * dy) ** .5
            at = int((math.atan2(dy, dx) + math.pi) / (2 * math.pi) * slices) % slices
            if ring[at] is None or reach > ring[at][0]:
                ring[at] = (reach, x, y)
        found = sorted(point for point in ring if point)
        # The middle of the spread, not its edge: a wheel keeps a few vertices well outside the
        # tyre, and a reference taken from those puts the circle round them instead of the tread.
        reference = radius or found[len(found) // 2][0]
        tread = [(x, y) for reach, x, y in found if abs(reach / reference - 1) < OFF_TREAD]
        fitted = fit_circle(tread) if len(tread) > 8 else None
        if not fitted:
            break
        centre, radius = (fitted[0], fitted[1]), fitted[2]
    off = max((abs(((x - centre[0]) ** 2 + (y - centre[1]) ** 2) ** .5 - radius) for x, y in tread), default=0)
    return centre, radius, off


# A wheel modelled on its own, to drop into the hole the mark leaves. Cutting the tyre out of the
# car works, but it can only ever return what the car was drawn with: a couple of thousand faces
# and the two and a half per cent of the body's texture atlas that the wheel happened to get. The
# same wheel asked for on its own comes back with the whole budget - the one here is 156k faces on
# a 4096 texture, with spokes, lug bolts and a tread pattern. Sources live in <source>/wheels.
WHEEL_FACES = 12000
WHEEL_TEXTURE = 1024


def wheel_asset(style: str):
    """Load a wheel and leave it centred on its tread, axle along X, radius 1 and half-width 1."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE / "wheels" / f"{style}.glb"))
    added = [obj for obj in bpy.data.objects if obj not in before]
    meshes = [obj for obj in added if obj.type == "MESH"]
    assert len(meshes) == 1, f"wheel '{style}' is one mesh, got {len(meshes)}"
    wheel = meshes[0]
    wheel.data.transform(wheel.matrix_world)
    wheel.matrix_world = Matrix.Identity(4)
    for obj in added:
        if obj is not wheel:
            bpy.data.objects.remove(obj, do_unlink=True)
    if len(wheel.data.polygons) > WHEEL_FACES:
        decimate([wheel], WHEEL_FACES / len(wheel.data.polygons))
    # A wheel is the one shape whose narrowest axis is the one it turns about, so the model does
    # not have to arrive pointing any particular way - it says so itself.
    spans = [max(v.co[i] for v in wheel.data.vertices) - min(v.co[i] for v in wheel.data.vertices) for i in range(3)]
    axle = min(range(3), key=lambda i: spans[i])
    if axle:
        wheel.data.transform(Matrix.Rotation(-math.pi / 2, 4, "Z") if axle == 1 else Matrix.Rotation(math.pi / 2, 4, "Y"))
        spans = [spans[axle]] + [spans[i] for i in range(3) if i != axle]
    assert abs(spans[1] / spans[2] - 1) < .05, f"wheel '{style}' is not round: {tuple(round(v, 3) for v in spans)}"
    # Which end of it is the face. A wheel is closed on the outside, where the spokes cover the
    # hub, and open on the inside, where you look down the barrel - so the half with geometry
    # nearest the axle is the one that has to end up pointing away from the car.
    reach = lambda half: min(((v.co[1] ** 2 + v.co[2] ** 2) ** .5 for v in wheel.data.vertices if half * v.co[0] > 0), default=1e9)
    if reach(-1) < reach(1):
        wheel.data.transform(Matrix.Diagonal((-1, 1, 1, 1)))
        wheel.data.flip_normals()
    # Only this wheel's own maps. Reaching for every image in the file took the car's body texture
    # down with them, and a body is the one thing in the scene that is looked at up close.
    for slot in wheel.material_slots:
        if not slot.material or not slot.material.use_nodes:
            continue
        for node in slot.material.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image and max(node.image.size) > WHEEL_TEXTURE:
                node.image.scale(WHEEL_TEXTURE, WHEEL_TEXTURE)
    centre, radius, _ = tread_circle([(v.co[1], v.co[2]) for v in wheel.data.vertices])
    half = (max(v.co[0] for v in wheel.data.vertices) - min(v.co[0] for v in wheel.data.vertices)) / 2
    middle = (max(v.co[0] for v in wheel.data.vertices) + min(v.co[0] for v in wheel.data.vertices)) / 2
    wheel.data.transform(Matrix.Translation((-middle, -centre[0], -centre[1])))
    wheel.data.transform(Matrix.Diagonal((1 / half, 1 / radius, 1 / radius, 1)))
    print(f"wheel '{style}': {len(wheel.data.polygons)} faces, was {radius:.4f} by {half * 2:.4f}")
    return wheel


def fit_wheels(objects, cylinders, style: str):
    """Put a copy of the wheel asset in each marked cylinder."""
    asset = wheel_asset(style)
    for index, cylinder in enumerate(cylinders):
        axle = cylinder["axle"]
        mesh = asset.data.copy()
        # The face of the wheel points away from the car, so the far side of each axle is the
        # mirror of the near one - otherwise one flank of the car shows its spokes and the other
        # shows the inside of the barrel.
        outward = 1 if cylinder["centre"][axle] > 0 else -1
        mesh.transform(Matrix.Diagonal((cylinder["half"] * outward, cylinder["radius"], cylinder["radius"], 1)))
        if outward < 0:
            mesh.flip_normals()
        # The asset turns about X; a car whose wheels turn about Y wants it a quarter turn round.
        if axle == 1:
            mesh.transform(Matrix.Rotation(math.pi / 2, 4, "Z"))
        wheel = bpy.data.objects.new(f"WHL{index}_H", mesh)
        bpy.context.collection.objects.link(wheel)
        wheel.location = cylinder["centre"]
        objects.append(wheel)
    bpy.data.objects.remove(asset, do_unlink=True)


def take_wheels(objects, cylinders, style=None):
    """Cut the marked cylinders out of the body, and fill them with wheels that turn.

    With a `style` the wheel comes from its own model; without one it is lifted out of the body,
    which is all a car drawn in one piece can give.
    """
    meshes = [obj for obj in objects if obj.type == "MESH"]
    assert len(meshes) == 1, f"a marked car is one shell, got {len(meshes)} meshes"
    body = meshes[0]
    body.data.transform(body.matrix_world)
    body.matrix_world = Matrix.Identity(4)
    faces, verts = body.data.polygons, body.data.vertices
    picked = [inside(body.data, cylinder) for cylinder in cylinders]
    if style:
        fit_wheels(objects, cylinders, style)
        keep_faces(body.data, set(range(len(body.data.polygons))) - set().union(*picked))
        bpy.context.view_layer.update()
        return
    for index, (cylinder, taken) in enumerate(zip(cylinders, picked)):
        axle = cylinder["axle"]
        radial = [i for i in (0, 1, 2) if i != axle]

        def reach(vertex, centre):
            return ((verts[vertex].co[radial[0]] - centre[0]) ** 2 + (verts[vertex].co[radial[1]] - centre[1]) ** 2) ** .5

        centre, radius, off = tread_circle([(verts[i].co[radial[0]], verts[i].co[radial[1]])
                                            for face in taken for i in faces[face].vertices])
        before = len(taken)
        # The ragged edge of the cut. A face is taken by where its centre falls, so one that
        # straddled the mark can have a corner a long way past the tread - and a wheel drawn round
        # those corners turns about the wrong point and hangs above the road. They stay on the body.
        taken -= {face for face in taken
                  if any(reach(i, centre) > radius * (1 + OFF_TREAD) for i in faces[face].vertices)}
        # A low-poly source carries a couple of hundred faces per wheel; the floor only catches a
        # mark that missed the car altogether.
        assert len(taken) > 60, f"WHL{index}_H mark took {len(taken)} faces: it is not on the wheel"
        mesh = body.data.copy()
        keep_faces(mesh, taken)
        pivot = Vector((0.0, 0.0, 0.0))
        pivot[radial[0]], pivot[radial[1]] = centre
        # Across the car the wheel sits where the mark says, not where its own geometry averages
        # out: that half of the pivot is mirrored, so a pair cannot end up at two different
        # distances from the centre line.
        pivot[axle] = cylinder["centre"][axle]
        mesh.transform(Matrix.Translation(-pivot))
        wheel = bpy.data.objects.new(f"WHL{index}_H", mesh)
        bpy.context.collection.objects.link(wheel)
        wheel.location = pivot
        objects.append(wheel)
        print(f"WHL{index}_H: {len(taken)} faces ({before - len(taken)} ragged), tread radius {radius:.4f} "
              f"round to {off / radius * 100:.1f}%, in a {cylinder['radius'] * 2:.4f} x {cylinder['half'] * 2:.4f} mark")
    keep_faces(body.data, set(range(len(body.data.polygons))) - set().union(*picked))
    bpy.context.view_layer.update()


def seat_wheels(wheels):
    """Puts every tyre on the road, turning about its own middle.

    Measured on the finished wheel rather than on the cut, because the bake scales the car and
    drops it on the ground after the wheels have come out of it. The hub goes to the centre of the
    tread - anywhere else and the wheel wobbles as it turns - and the tread goes to the ground.
    """
    for obj in wheels:
        (across, up), radius, _ = tread_circle([(v.co[1], v.co[2]) for v in obj.data.vertices])
        obj.data.transform(Matrix.Translation((0, -across, -up)))
        at = obj.matrix_world.translation
        obj.matrix_world = Matrix.Translation((at.x, at.y + across, radius))
    bpy.context.view_layer.update()


# --- body -----------------------------------------------------------------------------------


def tame_paint(objects):
    """Drop the source's metallic-roughness map and make every body material satin car paint.

    Image-to-3D bodies arrive with an ORM texture baked at metallic 1, so the runtime's scalar clamp is
    multiplied back up by the map and the body renders as a mirror. Unlinking the map leaves
    the exporter with plain factors."""
    materials = {slot.material for obj in objects if obj.type == "MESH" for slot in obj.material_slots if slot.material}
    for material in materials:
        if not material.use_nodes:
            continue
        shader = next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
        if shader is None:
            continue
        for name, value in (("Metallic", 0.0), ("Roughness", PAINT_ROUGHNESS)):
            socket = shader.inputs[name]
            for link in list(socket.links):
                material.node_tree.links.remove(link)
            socket.default_value = value


def add_blank_plates(boxes):
    """Cover textured plate lettering with clean white plate surfaces."""
    if not boxes:
        return 0
    material = bpy.data.materials.new("BlankPlate")
    material.use_nodes = True
    shader = material.node_tree.nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = (0.01, 0.01, 0.01, 1)
    shader.inputs["Metallic"].default_value = 0.0
    shader.inputs["Roughness"].default_value = 0.55
    for index, plate in enumerate(boxes):
        center = plate["center"]
        width, height = plate["size"]
        bpy.ops.mesh.primitive_cube_add(location=center)
        obj = bpy.context.object
        obj.name = f"PLATE{index}_H"
        obj.dimensions = (width, plate.get("thickness", 0.006), height)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.data.materials.append(material)
        bevel = obj.modifiers.new("soft plate corners", "BEVEL")
        bevel.width = min(plate.get("bevel", 0.006), width / 8, height / 4)
        bevel.segments = 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=bevel.name)
    return len(boxes)


def add_headlights(objects, min_corner, max_corner):
    size = max_corner - min_corner
    center = (min_corner + max_corner) * .5
    for index, x in enumerate((-size.x * .27, size.x * .27)):
        # Blender's glTF exporter can collapse a standalone empty to the scene
        # origin. A tiny hidden marker mesh keeps the authored light position.
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=8,
            ring_count=4,
            radius=max(size.x * .025, .03),
            location=(center.x + x, max_corner.y - size.y * .015, min_corner.z + size.z * .52),
        )
        marker = bpy.context.object
        marker.name = f"HEADLIGHT{index}_H"
        objects.append(marker)


def drop_empty_nodes(objects):
    """Delete childless empties: a source file's root empty carries no geometry and its pivot
    would be the only non-identity transform left after the meshes are baked."""
    for obj in list(objects):
        if obj.type == "EMPTY" and not obj.children:
            objects.remove(obj)
            bpy.data.objects.remove(obj, do_unlink=True)


def bake_orientation(objects):
    """Push every rotation and scale into the vertices, leaving each node a plain position."""
    for obj in objects:
        if obj.type != "MESH" or obj.data is None:
            continue
        matrix = obj.matrix_world.copy()
        location = matrix.translation.copy()
        obj.data.transform(Matrix.Translation(-location) @ matrix)
        obj.matrix_world = Matrix.Translation(location)


def validate_normalized(objects, wheels, dimensions):
    """Reject exports that violate the canonical Y-up, front -Z contract."""
    min_corner, max_corner = bounds(objects)
    center = (min_corner + max_corner) * .5
    assert abs(center.x) < .03, f"model is off-center on X: {center.x:.4f} m"
    assert abs(center.y) < .03, f"model is off-center on length: {center.y:.4f} m"
    assert abs(min_corner.z) < .01, f"model is not on the ground: {min_corner.z:.4f} m"
    assert len(wheels) == 4, f"expected four wheel nodes, got {len(wheels)}"
    wheel_by_name = {obj.name: obj for obj in wheels}
    front = sum(wheel_by_name[name].matrix_world.translation.y for name in ("WHL0_H", "WHL1_H")) / 2
    rear = sum(wheel_by_name[name].matrix_world.translation.y for name in ("WHL2_H", "WHL3_H")) / 2
    assert front > rear, "front wheel nodes must point toward -Z"
    # Same track-width definition as tests/models.test.mjs: the mean hub X per side, so a source
    # whose front and rear tracks differ slightly still fits one catalog number.
    track_width = abs(sum(obj.matrix_world.translation.x for obj in wheels if obj.matrix_world.translation.x > 0)
                      - sum(obj.matrix_world.translation.x for obj in wheels if obj.matrix_world.translation.x < 0)) / 2
    wheelbase = front - rear
    assert abs(track_width - dimensions["trackWidth"]) < .03, f"track width mismatch: {track_width:.4f} m"
    assert abs(wheelbase - dimensions["wheelbase"]) < .03, f"wheelbase mismatch: {wheelbase:.4f} m"
    # Some sources ship staggered wheels (a larger rear radius), which is a real design rather
    # than a bake error, so the catalog radius is compared against the mean of the four. Measured
    # on the tread, like the seating: a bounding box would count whatever the cut left sticking out.
    radii = [tread_circle([(v.co[1], v.co[2]) for v in obj.data.vertices])[1] for obj in wheels]
    mean_radius = sum(radii) / len(radii)
    assert abs(mean_radius - dimensions["wheelRadius"]) < .03, f"wheel radius mismatch: mean {mean_radius:.4f} of {[round(r, 3) for r in radii]}"
    for obj in objects:
        if obj.type != "MESH":
            continue
        basis = obj.matrix_world.to_3x3()
        assert all(abs(basis[row][column] - (1 if row == column else 0)) < 1e-5
                   for row in range(3) for column in range(3)), f"{obj.name} has baked transform residue"


def preview(objects, target: Path):
    """Draw the baked car with the wheels in red: one frame, the side beside the front.

    What a mark takes and what the body loses are the same faces, so red is both at once - the
    wheel that will turn, and the hole it leaves behind.
    """
    min_corner, max_corner = bounds(objects)
    size = max_corner - min_corner
    gap = size.y * .06
    # The camera looks down +Y, so the side view is a copy turned a quarter turn and parked to the
    # left of the car's own front view: one frame answers both "is that the tyre" and "only the tyre".
    aside = (size.x + size.y) / 2 + gap
    for obj in [obj for obj in objects if obj.type == "MESH"]:
        obj.color = (.85, .15, .1, 1) if obj.name.startswith("WHL") else (.62, .63, .65, 1)
        turned = obj.copy()
        turned.matrix_world = Matrix.Translation((-aside, 0, 0)) @ Matrix.Rotation(math.pi / 2, 4, "Z") @ obj.matrix_world
        bpy.context.collection.objects.link(turned)
    camera = bpy.data.objects.new("preview", bpy.data.cameras.new("preview"))
    camera.data.type = "ORTHO"
    frame = (size.x + size.y + gap) * 1.03
    camera.data.ortho_scale = frame
    middle = (size.x / 2 - aside - size.y / 2) / 2
    camera.matrix_world = Matrix.Translation((middle, -size.y * 4, size.z / 2)) @ Matrix.Rotation(math.pi / 2, 4, "X")
    bpy.context.collection.objects.link(camera)
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.color_type = "OBJECT"
    scene.display.shading.light = "STUDIO"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = int(1600 * size.z * 1.35 / frame)
    scene.render.film_transparent = False
    target.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(target)
    bpy.ops.render.render(write_still=True)
    print(f"preview: {target}")


def normalize(vehicle, drawing: bool):
    model = vehicle["model"]
    dimensions = vehicle["dimensions"]
    name = model["source"]
    marks = model.get("wheels")
    source = SOURCE / "vehicles" / name / f"{name}.glb"
    target = ROOT / "assets" / "vehicles" / f"{vehicle['id']}.glb"
    clear_scene()
    objects = import_model(source)
    if model.get("decimate"):
        decimate(objects, model["decimate"])
    if marks:
        take_wheels(objects, marked_wheels(marks, model["sourceRotationZ"]), marks.get("style"))
    # First orient the source so its authored front points toward -Z.
    apply_world_transform(objects, model["sourceRotationZ"], 1.0)
    narrow(objects, model.get("widthScale", 1))
    min_corner, max_corner = bounds(objects)
    size = max_corner - min_corner
    wheels = rename_wheels(objects)
    # The marks carry the car's own wheelbase, so the scale that makes it the catalog's comes
    # straight off them - no measuring what the cut happened to leave behind.
    scale = dimensions["wheelbase"] / abs(marks["front"]["along"] - marks["rear"]["along"]) if marks else 4.0 / max(size.x, size.y)
    apply_world_transform(objects, 0, scale)
    min_corner, max_corner = bounds(objects)
    if marks:
        add_headlights(objects, min_corner, max_corner)
    center = (min_corner + max_corner) * .5
    translation = Matrix.Translation(Vector((-center.x, -center.y, -min_corner.z)))
    for obj in objects:
        obj.matrix_world = translation @ obj.matrix_world
    if marks:
        bake_orientation(objects)
        drop_empty_nodes(objects)
    bpy.context.view_layer.update()
    seat_wheels(wheels)
    # Car paint, not wheels: a rim that is told it is a dielectric stops being metal.
    tame_paint([obj for obj in objects if not obj.name.startswith("WHL")])
    painted = add_blank_plates(model.get("blankPlates", []))
    if drawing:
        preview(objects, ROOT / "build" / "review" / "marks" / f"{vehicle['id']}.png")
        return
    validate_normalized(objects, wheels, dimensions)
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = next((obj for obj in objects if obj.type == "MESH"), None)
    bpy.ops.export_scene.gltf(filepath=str(target), export_format="GLB", export_apply=True, export_image_format="AUTO")
    print(f"{name}: wrote standard GLB ({len(wheels)} wheel nodes, {painted} blank plates)")


drawing = bool(os.environ.get("PREVIEW"))
for vehicle in VEHICLES:
    if os.environ.get("ONLY") and vehicle["id"] != os.environ["ONLY"]:
        continue
    normalize(vehicle, drawing)
