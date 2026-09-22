// Source track container readers: COLL (catalogue) and TRAC (geometry).
// Positions are 16.16 fixed point; track vertices are signed 16-bit block-local offsets.

const u8 = (b, o) => b.readUInt8(o);
const i8 = (b, o) => b.readInt8(o);
const u16 = (b, o) => b.readUInt16LE(o);
const i16 = (b, o) => b.readInt16LE(o);
const u32 = (b, o) => b.readUInt32LE(o);
const i32 = (b, o) => b.readInt32LE(o);

/** Fixed-point world position (16.16) to metres. */
export const fixed = (v) => v / 65536;

/** Extra-block ids shared by COL and TRK. */
export const XBID = {
  TEXTURE: 2, NEIGHBOUR: 4, POLY_TYPE: 5, MEDIAN: 6,
  STRUCTURE_REF_A: 7, STRUCTURE: 8, LANE: 9,
  VROAD: 13, COLLISION: 15, STRUCTURE_REF_B: 18, STRUCTURE_REF_C: 19,
};

const collisionRecord = (b, o) => ({
  position: [fixed(i32(b, o)), fixed(i32(b, o + 4)), fixed(i32(b, o + 8))],
  up: [i8(b, o + 12), i8(b, o + 13), i8(b, o + 14)],
  forward: [i8(b, o + 15), i8(b, o + 16), i8(b, o + 17)],
  right: [i8(b, o + 18), i8(b, o + 19), i8(b, o + 20)],
  block: u16(b, o + 22),
  unknown: u16(b, o + 24),
  leftBorder: u16(b, o + 26),
  rightBorder: u16(b, o + 28),
  postCrash: u16(b, o + 30),
  unknown2: u32(b, o + 32),
});

const readExtraBlock = (b, at) => {
  const recSize = u32(b, at);
  const id = u16(b, at + 4);
  const n = u16(b, at + 6);
  let p = at + 8;
  const out = { id, recSize, n };
  switch (id) {
    case XBID.TEXTURE: {
      out.textures = [];
      for (let i = 0; i < n; i++, p += 10) out.textures.push({
        texNumber: u16(b, p), alignment: u16(b, p + 2),
        rgb: [u8(b, p + 4), u8(b, p + 5), u8(b, p + 6)],
        rgBlack: [u8(b, p + 7), u8(b, p + 8), u8(b, p + 9)],
      });
      break;
    }
    case XBID.NEIGHBOUR: {
      out.neighbours = Array.from({ length: n }, (_, i) => i16(b, p + i * 2));
      break;
    }
    case XBID.POLY_TYPE: {
      out.polyTypes = Array.from({ length: n }, (_, i) => ({ vroad: u8(b, p + i * 2), behaviour: u8(b, p + i * 2 + 1) }));
      break;
    }
    case XBID.MEDIAN: {
      out.median = Array.from({ length: n }, (_, i) => Array.from({ length: 8 }, (_, k) => u8(b, p + i * 8 + k)));
      break;
    }
    case XBID.STRUCTURE_REF_A:
    case XBID.STRUCTURE_REF_B:
    case XBID.STRUCTURE_REF_C: {
      out.references = [];
      for (let i = 0; i < n; i++) {
        const size = u16(b, p), type = u8(b, p + 2), structure = u8(b, p + 3);
        const ref = { size, type, structure };
        if (type === 1 || type === 4) ref.position = [fixed(i32(b, p + 4)), fixed(i32(b, p + 8)), fixed(i32(b, p + 12))];
        else if (type === 3) {
          const length = u16(b, p + 4);
          ref.animDelay = u16(b, p + 6);
          ref.keyframes = Array.from({ length }, (_, k) => [fixed(i32(b, p + 8 + k * 20)), fixed(i32(b, p + 12 + k * 20)), fixed(i32(b, p + 16 + k * 20))]);
        }
        out.references.push(ref);
        p += size;
      }
      break;
    }
    case XBID.STRUCTURE: {
      out.structures = [];
      for (let i = 0; i < n; i++) {
        const size = u32(b, p), nVerts = u16(b, p + 4), nPoly = u16(b, p + 6);
        const verts = [], polys = [];
        for (let v = 0; v < nVerts; v++) verts.push([i16(b, p + 8 + v * 6), i16(b, p + 10 + v * 6), i16(b, p + 12 + v * 6)]);
        const po = p + 8 + nVerts * 6;
        for (let k = 0; k < nPoly; k++) polys.push({
          texture: i16(b, po + k * 8), otherSideTex: i16(b, po + k * 8 + 2),
          vertex: [u8(b, po + k * 8 + 4), u8(b, po + k * 8 + 5), u8(b, po + k * 8 + 6), u8(b, po + k * 8 + 7)],
        });
        out.structures.push({ size, verts, polys });
        p += size;
      }
      break;
    }
    case XBID.LANE: {
      out.lanes = Array.from({ length: n }, (_, i) => ({
        vertRef: u8(b, p + i * 4), trackPos: u8(b, p + i * 4 + 1), latPos: u8(b, p + i * 4 + 2), polyRef: u8(b, p + i * 4 + 3),
      }));
      break;
    }
    case XBID.VROAD: {
      out.vroad = Array.from({ length: n }, (_, i) => ({
        normal: [i16(b, p + i * 12), i16(b, p + i * 12 + 4), i16(b, p + i * 12 + 2)],
        forward: [i16(b, p + i * 12 + 6), i16(b, p + i * 12 + 10), i16(b, p + i * 12 + 8)],
      }));
      break;
    }
    case XBID.COLLISION: {
      out.collision = Array.from({ length: n }, (_, i) => collisionRecord(b, p + i * 36));
      break;
    }
    default:
      out.raw = b.subarray(p, p + n * Math.max(0, recSize - 8));
      break;
  }
  return out;
};

const indexBlocks = (blocks) => {
  const map = new Map();
  for (const block of blocks) map.set(block.id, block);
  return map;
};

/** Read a COLL file (header-relative extra-block offsets). */
export function readCol(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'COLL') throw new Error('COL: missing COLL signature');
  const version = u32(buffer, 4);
  const size = u32(buffer, 8);
  const nBlocks = u32(buffer, 12);
  const blocks = [];
  for (let i = 0; i < nBlocks; i++) {
    const at = 16 + u32(buffer, 16 + i * 4);
    blocks.push(readExtraBlock(buffer, at));
  }
  return { version, size, blocks, byId: indexBlocks(blocks) };
}

/**
 * Read a TRAC file. Superblocks hold the geometry; every track block keeps its
 * own vertex table, polygon table and extra-block table.
 */
export function readTrk(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'TRAC') throw new Error('TRK: missing TRAC signature');
  const nSuperBlocks = u32(buffer, 24);
  const nBlocks = u32(buffer, 28);
  const superBlockOffsets = Array.from({ length: nSuperBlocks }, (_, i) => u32(buffer, 32 + i * 4));
  const blockReferenceCoords = Array.from({ length: nBlocks }, (_, i) => {
    const o = 32 + nSuperBlocks * 4 + i * 12;
    return [fixed(i32(buffer, o)), fixed(i32(buffer, o + 4)), fixed(i32(buffer, o + 8))];
  });

  const blocks = [];
  for (const sbOffset of superBlockOffsets) {
    const nSbBlocks = u32(buffer, sbOffset + 4);
    for (let i = 0; i < nSbBlocks; i++) {
      const at = sbOffset + u32(buffer, sbOffset + 12 + i * 4);
      const header = {
        blockSize: u32(buffer, at), nExtraBlocks: u16(buffer, at + 8), serial: u16(buffer, at + 10),
        index: i32(buffer, at + 12),
        // Four world-space corners of the block's bounding quad (constant y): the render clip box.
        clip: Array.from({ length: 4 }, (_, k) => [fixed(i32(buffer, at + 16 + k * 12)), fixed(i32(buffer, at + 20 + k * 12)), fixed(i32(buffer, at + 24 + k * 12))]),
        extraTableOffset: u32(buffer, at + 64),
        nStickToNextVerts: u16(buffer, at + 68),
        nLowResVert: u16(buffer, at + 70), nMedResVert: u16(buffer, at + 72), nHighResVert: u16(buffer, at + 74),
        nLowResPoly: u16(buffer, at + 76), nMedResPoly: u16(buffer, at + 78), nHighResPoly: u16(buffer, at + 80),
      };
      const nVerts = header.nStickToNextVerts + header.nHighResVert;
      const verts = [];
      for (let v = 0; v < nVerts; v++) {
        const o = at + 88 + v * 6;
        verts.push([i16(buffer, o), i16(buffer, o + 2), i16(buffer, o + 4)]);
      }
      const nPolys = header.nLowResPoly + header.nMedResPoly + header.nHighResPoly;
      const polys = [];
      const po = at + 88 + nVerts * 6;
      for (let k = 0; k < nPolys; k++) polys.push({
        texture: i16(buffer, po + k * 8), otherSideTex: i16(buffer, po + k * 8 + 2),
        vertex: [u8(buffer, po + k * 8 + 4), u8(buffer, po + k * 8 + 5), u8(buffer, po + k * 8 + 6), u8(buffer, po + k * 8 + 7)],
      });

      const extra = [];
      const tableAt = at + 64 + header.extraTableOffset;
      for (let e = 0; e < header.nExtraBlocks; e++) extra.push(readExtraBlock(buffer, at + u32(buffer, tableAt + e * 4)));
      blocks.push({ ...header, offset: at, reference: blockReferenceCoords[blocks.length], verts, polys, extra, byId: indexBlocks(extra) });
    }
  }
  return { nSuperBlocks, nBlocks, blockReferenceCoords, blocks };
}
