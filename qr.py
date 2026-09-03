"""A QR encoder small enough to keep VybPort dependency-free.

Byte mode, error-correction level M, versions 1 to 6 — comfortably more than a LAN URL and a
pairing token need, and stopping at 6 means no version-information blocks, which only versions 7
and up carry. Output is SVG, so there is no image library either.
"""
from __future__ import annotations

# --- GF(256), the field QR does its error correction in -----------------------------------------
EXP: list[int] = [0] * 512
LOG: list[int] = [0] * 256
_x = 1
for _i in range(255):
    EXP[_i] = _x
    LOG[_x] = _i
    _x <<= 1
    if _x & 0x100:                       # reduce by the QR primitive polynomial x^8+x^4+x^3+x^2+1
        _x ^= 0x11D
for _i in range(255, 512):
    EXP[_i] = EXP[_i - 255]


def _mul(a: int, b: int) -> int:
    return 0 if a == 0 or b == 0 else EXP[LOG[a] + LOG[b]]


def _generator(degree: int) -> list[int]:
    """The generator polynomial (x-2^0)(x-2^1)... for `degree` error-correction codewords."""
    poly = [1]
    for power in range(degree):
        nxt = [0] * (len(poly) + 1)
        for index, coefficient in enumerate(poly):
            nxt[index] ^= coefficient
            nxt[index + 1] ^= _mul(coefficient, EXP[power])
        poly = nxt
    return poly


def reed_solomon(data: list[int], count: int) -> list[int]:
    """The `count` error-correction codewords for one block of data codewords."""
    poly, remainder = _generator(count), list(data) + [0] * count
    for index in range(len(data)):
        lead = remainder[index]
        if lead:
            for offset, coefficient in enumerate(poly):
                remainder[index + offset] ^= _mul(coefficient, lead)
    return remainder[len(data):]


# --- version tables, level M --------------------------------------------------------------------
# version: (ec codewords per block, [(block count, data codewords per block), ...])
VERSIONS: dict[int, tuple[int, list[tuple[int, int]]]] = {
    1: (10, [(1, 16)]),
    2: (16, [(1, 28)]),
    3: (26, [(1, 44)]),
    4: (18, [(2, 32)]),
    5: (24, [(2, 43)]),
    6: (16, [(4, 27)]),
}
ALIGNMENT: dict[int, list[int]] = {1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34]}


def _capacity(version: int) -> int:
    """Bytes of payload a version holds: its data codewords, less the 2-codeword byte-mode header."""
    _, blocks = VERSIONS[version]
    return sum(count * size for count, size in blocks) - 2


def _pick_version(length: int) -> int:
    for version in sorted(VERSIONS):
        if length <= _capacity(version):
            return version
    raise ValueError(f"{length} bytes is more than this encoder's QR versions carry.")


# --- payload ------------------------------------------------------------------------------------
def _codewords(payload: bytes, version: int) -> list[int]:
    ec_per_block, blocks = VERSIONS[version]
    total_data = sum(count * size for count, size in blocks)
    bits: list[int] = []
    for value, width in ((0b0100, 4), (len(payload), 8)):     # byte mode, then the length
        bits += [(value >> shift) & 1 for shift in range(width - 1, -1, -1)]
    for byte in payload:
        bits += [(byte >> shift) & 1 for shift in range(7, -1, -1)]
    bits += [0] * min(4, total_data * 8 - len(bits))          # terminator
    bits += [0] * (-len(bits) % 8)                            # to a whole codeword
    data = [int("".join(str(bit) for bit in bits[index:index + 8]), 2) for index in range(0, len(bits), 8)]
    for pad in range(total_data - len(data)):                 # the specified alternating filler
        data.append(0xEC if pad % 2 == 0 else 0x11)

    groups, position = [], 0
    for count, size in blocks:
        for _ in range(count):
            groups.append(data[position:position + size])
            position += size
    parity = [reed_solomon(group, ec_per_block) for group in groups]

    # Blocks are interleaved column-wise: one codeword from each block in turn, data then parity.
    out: list[int] = []
    for index in range(max(len(group) for group in groups)):
        out += [group[index] for group in groups if index < len(group)]
    for index in range(ec_per_block):
        out += [block[index] for block in parity]
    return out


# --- matrix ---------------------------------------------------------------------------------------
def _blank(size: int) -> tuple[list[list[int | None]], list[list[bool]]]:
    return [[None] * size for _ in range(size)], [[False] * size for _ in range(size)]


def _place_function_patterns(grid, fixed, version: int) -> None:
    size = len(grid)

    def square(top: int, left: int) -> None:
        for row in range(-1, 8):
            for column in range(-1, 8):
                r, c = top + row, left + column
                if 0 <= r < size and 0 <= c < size:
                    edge = row in (0, 6) and 0 <= column <= 6
                    side = column in (0, 6) and 0 <= row <= 6
                    core = 2 <= row <= 4 and 2 <= column <= 4
                    grid[r][c] = 1 if (edge or side or core) else 0
                    fixed[r][c] = True

    square(0, 0)
    square(0, size - 7)
    square(size - 7, 0)
    for index in range(size):                                  # timing patterns
        for row, column in ((6, index), (index, 6)):
            if grid[row][column] is None:
                grid[row][column] = 1 if index % 2 == 0 else 0
                fixed[row][column] = True
    centres = ALIGNMENT[version]
    for row in centres:
        for column in centres:
            if fixed[row][column]:                             # skips the three finder corners
                continue
            for dr in range(-2, 3):
                for dc in range(-2, 3):
                    grid[row + dr][column + dc] = 1 if max(abs(dr), abs(dc)) != 1 else 0
                    fixed[row + dr][column + dc] = True
    grid[size - 8][8], fixed[size - 8][8] = 1, True            # the always-dark module
    for row, column in _format_cells(size):                    # reserved until the mask is chosen
        fixed[row][column] = True
        if grid[row][column] is None:
            grid[row][column] = 0


def _format_cells(size: int) -> list[tuple[int, int]]:
    """The 15 format-info positions, twice over, in bit order 14..0."""
    first = [(8, 0), (8, 1), (8, 2), (8, 3), (8, 4), (8, 5), (8, 7), (8, 8),
             (7, 8), (5, 8), (4, 8), (3, 8), (2, 8), (1, 8), (0, 8)]
    second = [(size - 1 - index, 8) for index in range(7)] + [(8, size - 8 + index) for index in range(8)]
    return first + second


def _format_bits(mask: int) -> list[int]:
    """The 15 format bits, least-significant first, which is the order they are laid out in."""
    value = (0b00 << 3) | mask                                  # level M is 00
    remainder = value
    for _ in range(10):                                         # BCH(15,5), generator 0x537
        remainder = (remainder << 1) ^ (0x537 * ((remainder >> 9) & 1))
    bits = ((value << 10) | remainder) ^ 0x5412                 # the specified mask
    return [(bits >> shift) & 1 for shift in range(15)]


MASKS = [
    lambda r, c: (r + c) % 2 == 0,
    lambda r, c: r % 2 == 0,
    lambda r, c: c % 3 == 0,
    lambda r, c: (r + c) % 3 == 0,
    lambda r, c: (r // 2 + c // 3) % 2 == 0,
    lambda r, c: (r * c) % 2 + (r * c) % 3 == 0,
    lambda r, c: ((r * c) % 2 + (r * c) % 3) % 2 == 0,
    lambda r, c: ((r + c) % 2 + (r * c) % 3) % 2 == 0,
]


def _place_data(grid, fixed, codewords: list[int]) -> None:
    size = len(grid)
    bits = [(byte >> shift) & 1 for byte in codewords for shift in range(7, -1, -1)]
    index, upward, column = 0, True, size - 1
    while column > 0:
        if column == 6:                                        # the vertical timing column is skipped
            column -= 1
        rows = range(size - 1, -1, -1) if upward else range(size)
        for row in rows:
            for offset in (0, 1):
                c = column - offset
                if not fixed[row][c]:
                    grid[row][c] = bits[index] if index < len(bits) else 0
                    index += 1
        upward = not upward
        column -= 2


def _penalty(grid) -> int:
    size, score = len(grid), 0
    lines = [row[:] for row in grid] + [[grid[r][c] for r in range(size)] for c in range(size)]
    for line in lines:                                         # rule 1: runs of five or more
        run, previous = 1, line[0]
        for value in line[1:]:
            run = run + 1 if value == previous else 1
            previous = value
            if run == 5:
                score += 3
            elif run > 5:
                score += 1
    for row in range(size - 1):                                # rule 2: 2x2 blocks of one colour
        for column in range(size - 1):
            block = {grid[row][column], grid[row][column + 1], grid[row + 1][column], grid[row + 1][column + 1]}
            if len(block) == 1:
                score += 3
    finder = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]
    for line in lines:                                         # rule 3: finder-like sequences
        for start in range(len(line) - 10):
            window = line[start:start + 11]
            if window == finder or window == finder[::-1]:
                score += 40
    dark = sum(sum(row) for row in grid)                       # rule 4: overall balance
    percent = dark * 100 // (size * size)
    score += 10 * (abs(percent - 50) // 5)
    return score


def matrix(text: str) -> list[list[int]]:
    """The finished module grid for `text`, mask chosen by the specified penalty rules."""
    payload = text.encode("utf-8")
    version = _pick_version(len(payload))
    size = version * 4 + 17
    codewords = _codewords(payload, version)
    best, best_score = None, None
    for mask, predicate in enumerate(MASKS):
        grid, fixed = _blank(size)
        _place_function_patterns(grid, fixed, version)
        _place_data(grid, fixed, codewords)
        for row in range(size):
            for column in range(size):
                if not fixed[row][column] and predicate(row, column):
                    grid[row][column] ^= 1
        bits, cells = _format_bits(mask), _format_cells(size)
        for copy in (cells[:15], cells[15:]):                  # the same 15 bits, written twice
            for bit, (row, column) in zip(bits, copy):
                grid[row][column] = bit
        score = _penalty(grid)
        if best_score is None or score < best_score:
            best, best_score = grid, score
    return best


def svg(text: str, quiet: int = 4) -> str:
    """A crisp, scalable QR with no image library involved."""
    grid = matrix(text)
    size = len(grid) + quiet * 2
    runs = []
    for row, line in enumerate(grid):
        column = 0
        while column < len(line):
            if line[column]:
                start = column
                while column < len(line) and line[column]:
                    column += 1
                runs.append(f"M{start + quiet} {row + quiet}h{column - start}v1h-{column - start}z")
            else:
                column += 1
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
            f'shape-rendering="crispEdges" role="img" aria-label="Pairing QR code">'
            f'<rect width="{size}" height="{size}" fill="#fff"/>'
            f'<path fill="#000" d="{"".join(runs)}"/></svg>')
