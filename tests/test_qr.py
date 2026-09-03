from __future__ import annotations

import unittest

import qr


def decode(grid: list[list[int]]) -> str:
    """Read a matrix back the way a scanner would, to prove the writer laid it out correctly.

    This deliberately re-derives everything from the grid — the mask comes out of the format bits,
    not from the encoder — so a placement or masking bug cannot pass by agreeing with itself.
    """
    size = len(grid)
    version = (size - 17) // 4

    read = 0                                                   # format copy 1, least significant first
    for index, (row, column) in enumerate(qr._format_cells(size)[:15]):
        read |= grid[row][column] << index
    mask = ((read ^ 0x5412) >> 10) & 0b111

    _, fixed = qr._blank(size)
    qr._place_function_patterns([[None] * size for _ in range(size)], fixed, version)

    predicate, bits = qr.MASKS[mask], []
    upward, column = True, size - 1
    while column > 0:
        if column == 6:
            column -= 1
        for row in (range(size - 1, -1, -1) if upward else range(size)):
            for offset in (0, 1):
                c = column - offset
                if not fixed[row][c]:
                    bits.append(grid[row][c] ^ (1 if predicate(row, c) else 0))
        upward = not upward
        column -= 2

    stream = [int("".join(str(bit) for bit in bits[i:i + 8]), 2) for i in range(0, len(bits) - 7, 8)]

    ec_per_block, blocks = qr.VERSIONS[version]
    sizes = [size_ for count, size_ in blocks for _ in range(count)]
    groups: list[list[int]] = [[] for _ in sizes]
    position = 0
    for index in range(max(sizes)):                            # undo the column-wise interleave
        for block, length in enumerate(sizes):
            if index < length:
                groups[block].append(stream[position])
                position += 1
    data = [byte for group in groups for byte in group]

    flat = [(byte >> shift) & 1 for byte in data for shift in range(7, -1, -1)]
    assert flat[:4] == [0, 1, 0, 0], "not byte mode"
    length = int("".join(str(bit) for bit in flat[4:12]), 2)
    payload = bytes(int("".join(str(bit) for bit in flat[12 + i * 8:20 + i * 8]), 2) for i in range(length))
    return payload.decode("utf-8")


class QrTests(unittest.TestCase):
    def test_reed_solomon_matches_the_published_example(self):
        data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]
        self.assertEqual(qr.reed_solomon(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23])

    def test_format_bits_match_the_published_strings(self):
        published = {
            0: "101010000010010", 1: "101000100100101", 2: "101111001111100", 3: "101101101001011",
            4: "100010111111001", 5: "100000011001110", 6: "100111110010111", 7: "100101010100000",
        }
        for mask, want in published.items():
            got = "".join(str(bit) for bit in reversed(qr._format_bits(mask)))
            self.assertEqual(got, want, f"mask {mask}")

    def test_a_matrix_reads_back_as_what_went_in(self):
        for text in ["x", "http://10.0.0.54:4173/mobile.html",
                     "http://10.0.0.54:4173/mobile.html#p=" + "A" * 43,
                     "http://vybport.local:4173/mobile.html#p=" + "z9-_" * 10]:
            with self.subTest(length=len(text)):
                self.assertEqual(decode(qr.matrix(text)), text)

    def test_every_version_this_encoder_claims_round_trips(self):
        for version in sorted(qr.VERSIONS):
            text = "u" * qr._capacity(version)
            grid = qr.matrix(text)
            self.assertEqual(len(grid), version * 4 + 17)
            self.assertEqual(decode(grid), text)

    def test_the_three_finder_patterns_are_where_a_scanner_looks(self):
        grid = qr.matrix("http://10.0.0.54:4173/mobile.html")
        size = len(grid)
        for top, left in ((0, 0), (0, size - 7), (size - 7, 0)):
            rows = [grid[top + r][left:left + 7] for r in range(7)]
            self.assertEqual(rows[0], [1] * 7)
            self.assertEqual(rows[3], [1, 0, 1, 1, 1, 0, 1])
            self.assertEqual(rows[1], [1, 0, 0, 0, 0, 0, 1])

    def test_too_much_text_is_refused_rather_than_silently_truncated(self):
        with self.assertRaises(ValueError):
            qr.matrix("q" * 200)

    def test_svg_is_self_contained(self):
        markup = qr.svg("http://10.0.0.54:4173/mobile.html")
        self.assertTrue(markup.startswith("<svg"))
        self.assertNotIn("<image", markup)
        self.assertIn("shape-rendering", markup)


if __name__ == "__main__":
    unittest.main()
