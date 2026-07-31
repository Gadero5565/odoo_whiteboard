import base64
from io import BytesIO
import json
from unittest.mock import patch

from PIL import Image
from odoo.exceptions import ValidationError
from odoo.tests.common import TransactionCase

from ..models import models as whiteboard_models
from ..models.models import (
    MAX_BOARD_NAME_LENGTH,
    MAX_CANVAS_OBJECTS,
    MAX_JSON_BYTES,
    MAX_PATH_COMMANDS,
    MAX_TEXT_LENGTH,
    MAX_THUMBNAIL_BYTES,
    MAX_THUMBNAIL_WIDTH,
    NORMALIZED_THUMBNAIL_MAX_BYTES,
    NORMALIZED_THUMBNAIL_MAX_HEIGHT,
    NORMALIZED_THUMBNAIL_MAX_WIDTH,
)


class TestWhiteboardPayloadValidation(TransactionCase):

    def setUp(self):
        super().setUp()
        self.Board = self.env["whiteboard.board"]

    def _validate(self, payload):
        return self.Board._validate_data_json(json.dumps(payload))

    def _png_base64(self, width=32, height=32):
        buffer = BytesIO()

        Image.new(
            "RGB",
            (width, height),
            color="white",
        ).save(
            buffer,
            format="PNG",
        )

        return base64.b64encode(
            buffer.getvalue()
        ).decode("ascii")

    def _valid_payload(self):
        return {
            "version": "5.3.0",
            "background": "white",
            "objects": [
                {
                    "type": "path",
                    "path": [["M", 0, 0], ["Q", 10, 10, 20, 20]],
                    "fill": None,
                    "stroke": "#111111",
                    "strokeWidth": 4,
                },
                {
                    "type": "i-text",
                    "text": "Type here",
                    "left": 80,
                    "top": 80,
                    "fontSize": 28,
                    "fill": "#111111",
                },
                {
                    "type": "rect",
                    "left": 160,
                    "top": 120,
                    "width": 190,
                    "height": 110,
                    "fill": "rgba(255, 255, 255, 0.96)",
                    "stroke": "#111111",
                    "strokeWidth": 2,
                    "wbId": "rectangle_1",
                    "wbType": "shape",
                    "wbShape": "rectangle",
                    "wbVersion": 1,
                },
                {
                    "type": "circle",
                    "left": 300,
                    "top": 120,
                    "radius": 62,
                    "fill": "white",
                    "stroke": "#111111",
                    "wbId": "circle_1",
                    "wbType": "shape",
                    "wbShape": "circle",
                    "wbVersion": 1,
                },
                {
                    "type": "polygon",
                    "points": [
                        {"x": 0, "y": -60},
                        {"x": 90, "y": 0},
                        {"x": 0, "y": 60},
                        {"x": -90, "y": 0},
                    ],
                    "fill": "white",
                    "stroke": "#111111",
                    "wbId": "diamond_1",
                    "wbType": "shape",
                    "wbShape": "diamond",
                    "wbVersion": 1,
                },
                {
                    "type": "line",
                    "x1": 0,
                    "y1": 0,
                    "x2": 220,
                    "y2": 0,
                    "fill": "#111111",
                    "stroke": "#111111",
                    "wbId": "line_1",
                    "wbType": "shape",
                    "wbShape": "line",
                    "wbVersion": 1,
                },
                {
                    "type": "group",
                    "left": 400,
                    "top": 300,
                    "objects": [
                        {
                            "type": "rect",
                            "left": -115,
                            "top": -42,
                            "width": 230,
                            "height": 84,
                            "fill": "rgba(255, 255, 255, 0.98)",
                            "stroke": "#111111",
                            "strokeWidth": 2,
                            "wbId": "node_background_1",
                            "wbRole": "node_background",
                            "wbVersion": 1,
                        },
                        {
                            "type": "textbox",
                            "text": "Main Idea",
                            "left": -95,
                            "top": -14,
                            "width": 190,
                            "fontSize": 18,
                            "fill": "#0f172a",
                            "wbId": "node_text_1",
                            "wbRole": "node_text",
                            "wbVersion": 1,
                        },
                    ],
                    "wbId": "mind_node_1",
                    "wbType": "mind_node",
                    "wbShape": "mind_node",
                    "wbNodeType": "mind_node",
                    "wbText": "Main Idea",
                    "wbVersion": 1,
                },
                {
                    "type": "path",
                    "path": [["M", -100, 0], ["L", 80, 0], ["L", 100, 0]],
                    "fill": None,
                    "stroke": "#111111",
                    "strokeWidth": 3,
                    "wbId": "connector_1",
                    "wbType": "connector",
                    "wbShape": "arrow",
                    "wbConnectorType": "straight_arrow",
                    "wbFromNodeId": "mind_node_1",
                    "wbToNodeId": "rectangle_1",
                    "wbVersion": 1,
                },
            ],
        }

    def test_valid_current_editor_payload_is_accepted(self):
        valid, normalized = self._validate(self._valid_payload())

        self.assertTrue(valid)
        self.assertEqual(json.loads(normalized), self._valid_payload())

    def test_empty_legacy_payload_is_accepted(self):
        for value in (None, False, "", "{}"):
            valid, normalized = self.Board._validate_data_json(value)
            self.assertTrue(valid)
            self.assertEqual(normalized, "{}")

    def test_direct_create_cannot_bypass_validation(self):
        with self.assertRaises(ValidationError):
            self.Board.create({
                "name": "Invalid board",
                "data_json": '{"objects":[{"type":"image","src":"https://example.com/a.png"}]}',
            })

    def test_direct_write_cannot_bypass_validation(self):
        board = self.Board.create({"name": "Validation test"})

        with self.assertRaises(ValidationError):
            board.write({
                "data_json": '{"objects":[{"type":"rect","clipPath":{"type":"circle"}}]}',
            })

    def test_direct_write_accepts_current_editor_payload(self):
        board = self.Board.create({"name": "Valid board", "data_json": False})
        valid_payload = self._valid_payload()

        board.write({"data_json": json.dumps(valid_payload)})

        self.assertEqual(json.loads(board.data_json), valid_payload)

    def test_unknown_object_type_is_rejected(self):
        payload = self._valid_payload()
        payload["objects"] = [{"type": "image", "src": "https://example.com/a.png"}]

        valid, _error = self._validate(payload)

        self.assertFalse(valid)

    def test_external_fabric_content_is_rejected(self):
        payload = self._valid_payload()
        payload["objects"][0]["sourcePath"] = "https://example.com/path.json"

        valid, _error = self._validate(payload)

        self.assertFalse(valid)

    def test_clip_path_is_rejected(self):
        payload = self._valid_payload()
        payload["objects"][2]["clipPath"] = {"type": "circle", "radius": 10}

        valid, _error = self._validate(payload)

        self.assertFalse(valid)

    def test_gradient_or_pattern_fill_is_rejected(self):
        payload = self._valid_payload()
        payload["objects"][2]["fill"] = {
            "type": "linear",
            "colorStops": [{"offset": 0, "color": "#fff"}],
        }

        valid, _error = self._validate(payload)

        self.assertFalse(valid)

    def test_non_finite_json_number_is_rejected(self):
        valid, _error = self.Board._validate_data_json(
            '{"objects":[{"type":"rect","left":NaN}]}'
        )

        self.assertFalse(valid)

    def test_duplicate_json_keys_are_rejected(self):
        valid, _error = self.Board._validate_data_json(
            '{"objects":[],"objects":[]}'
        )

        self.assertFalse(valid)

    def test_prototype_pollution_key_is_rejected(self):
        valid, _error = self.Board._validate_data_json(
            '{"objects":[{"type":"rect","__proto__":{"polluted":true}}]}'
        )

        self.assertFalse(valid)

    def test_object_limit_is_enforced(self):
        payload = {
            "objects": [
                {"type": "rect", "fill": "white", "stroke": "black"}
                for _index in range(MAX_CANVAS_OBJECTS + 1)
            ]
        }

        valid, _error = self._validate(payload)

        self.assertFalse(valid)

    def test_text_limit_is_enforced(self):
        payload = {
            "objects": [
                {
                    "type": "i-text",
                    "text": "x" * (MAX_TEXT_LENGTH + 1),
                    "fill": "#111111",
                }
            ]
        }

        valid, _error = self._validate(payload)

        self.assertFalse(valid)

    def test_path_complexity_limit_is_enforced(self):
        payload = {
            "objects": [
                {
                    "type": "path",
                    "path": [["L", 1, 1] for _index in range(MAX_PATH_COMMANDS + 1)],
                    "fill": None,
                    "stroke": "#111111",
                }
            ]
        }

        valid, _error = self._validate(payload)

        self.assertFalse(valid)

    def test_group_depth_limit_is_enforced(self):
        nested = {"type": "rect", "fill": "white", "stroke": "black"}
        for _index in range(4):
            nested = {"type": "group", "objects": [nested]}

        valid, _error = self._validate({"objects": [nested]})

        self.assertFalse(valid)

    def test_extreme_scale_is_rejected(self):
        payload = {
            "objects": [
                {
                    "type": "rect",
                    "scaleX": 1000,
                    "scaleY": 1,
                    "fill": "white",
                }
            ]
        }

        valid, _error = self._validate(payload)

        self.assertFalse(valid)

    def test_metadata_type_mismatch_is_rejected(self):
        payload = {
            "objects": [
                {
                    "type": "circle",
                    "wbType": "shape",
                    "wbShape": "rectangle",
                }
            ]
        }

        valid, _error = self._validate(payload)

        self.assertFalse(valid)

    def test_canvas_image_property_is_rejected(self):
        payload = {
            "objects": [],
            "backgroundImage": {
                "type": "image",
                "src": "https://example.com/background.png",
            },
        }

        valid, _error = self._validate(payload)

        self.assertFalse(valid)

    def test_json_byte_limit_is_enforced(self):
        valid, _error = self.Board._validate_data_json(
            " " * (MAX_JSON_BYTES + 1)
        )

        self.assertFalse(valid)

    def test_board_creation_quota_is_enforced(self):
        existing_count = (
            self.Board.sudo()
            .with_context(active_test=False)
            .search_count([
                ("user_id", "=", self.env.uid),
            ])
        )

        with patch.object(
                whiteboard_models,
                "MAX_BOARDS_PER_USER",
                existing_count + 2,
        ):
            self.Board.create({"name": "Quota 1"})
            self.Board.create({"name": "Quota 2"})

            with self.assertRaises(ValidationError):
                self.Board.create({"name": "Quota 3"})

    def test_board_creation_quota_counts_archived_boards(self):
        existing_count = (
            self.Board.sudo()
            .with_context(active_test=False)
            .search_count([
                ("user_id", "=", self.env.uid),
            ])
        )

        with patch.object(
                whiteboard_models,
                "MAX_BOARDS_PER_USER",
                existing_count + 1,
        ):
            board = self.Board.create({
                "name": "Archived quota board",
            })

            board.write({"active": False})

            with self.assertRaises(ValidationError):
                self.Board.create({
                    "name": "Quota bypass attempt",
                })

    def test_multi_create_cannot_bypass_board_quota(self):
        existing_count = (
            self.Board.sudo()
            .with_context(active_test=False)
            .search_count([
                ("user_id", "=", self.env.uid),
            ])
        )

        with patch.object(
                whiteboard_models,
                "MAX_BOARDS_PER_USER",
                existing_count + 1,
        ):
            with self.assertRaises(ValidationError):
                self.Board.create([
                    {"name": "Batch 1"},
                    {"name": "Batch 2"},
                ])

    def test_board_list_result_limit_is_enforced(self):
        first = self.Board.create({
            "name": "List limit 1",
        })
        second = self.Board.create({
            "name": "List limit 2",
        })
        third = self.Board.create({
            "name": "List limit 3",
        })

        with patch.object(
                whiteboard_models,
                "MAX_BOARD_LIST_RESULTS",
                2,
        ):
            result = self.Board.get_user_boards(
                offset=0,
                limit=100,
            )

        board_ids = [
            board["id"]
            for board in result["boards"]
        ]

        self.assertEqual(
            board_ids,
            [third.id, second.id],
        )

        self.assertNotIn(
            first.id,
            board_ids,
        )

        self.assertTrue(
            result["has_more"],
        )

        self.assertEqual(
            result["next_offset"],
            2,
        )

    def test_valid_thumbnail_data_url_is_normalized(self):
        thumbnail_b64 = self._png_base64()

        valid, normalized = (
            self.Board._extract_thumbnail_base64(
                "data:image/png;base64,%s"
                % thumbnail_b64
            )
        )

        self.assertTrue(valid)
        self.assertNotEqual(
            normalized,
            thumbnail_b64,
        )

        normalized_bytes = base64.b64decode(
            normalized
        )

        self.assertLessEqual(
            len(normalized_bytes),
            NORMALIZED_THUMBNAIL_MAX_BYTES,
        )

        with Image.open(
                BytesIO(normalized_bytes)
        ) as image:
            self.assertEqual(
                image.format,
                "JPEG",
            )

            self.assertEqual(
                image.mode,
                "RGB",
            )

            self.assertLessEqual(
                image.width,
                NORMALIZED_THUMBNAIL_MAX_WIDTH,
            )

            self.assertLessEqual(
                image.height,
                NORMALIZED_THUMBNAIL_MAX_HEIGHT,
            )

    def test_thumbnail_must_be_a_real_image(self):
        fake_image = base64.b64encode(
            b"not an image"
        ).decode("ascii")

        valid, _error = (
            self.Board._extract_thumbnail_base64(
                fake_image
            )
        )

        self.assertFalse(valid)

    def test_thumbnail_byte_limit_is_enforced(self):
        oversized = base64.b64encode(
            b"x" * (MAX_THUMBNAIL_BYTES + 1)
        ).decode("ascii")

        valid, _error = (
            self.Board._extract_thumbnail_base64(
                oversized
            )
        )

        self.assertFalse(valid)

    def test_thumbnail_dimension_limit_is_enforced(self):
        oversized_dimensions = self._png_base64(
            width=MAX_THUMBNAIL_WIDTH + 1,
            height=1,
        )

        valid, _error = (
            self.Board._extract_thumbnail_base64(
                oversized_dimensions
            )
        )

        self.assertFalse(valid)

    def test_direct_create_cannot_bypass_thumbnail_validation(self):
        fake_image = base64.b64encode(
            b"not an image"
        ).decode("ascii")

        with self.assertRaises(ValidationError):
            self.Board.create({
                "name": "Invalid thumbnail",
                "thumbnail": fake_image,
            })

    def test_direct_write_cannot_bypass_thumbnail_validation(self):
        board = self.Board.create({
            "name": "Thumbnail validation",
        })

        fake_image = base64.b64encode(
            b"not an image"
        ).decode("ascii")

        with self.assertRaises(ValidationError):
            board.write({
                "thumbnail": fake_image,
            })

    def test_text_object_accepts_fabric_null_path_property(self):
        payload = {
            "objects": [
                {
                    "type": "textbox",
                    "text": "Flowchart node",
                    "path": None,
                    "fill": "#0f172a",
                    "fontSize": 16,
                }
            ],
        }

        valid, error = self._validate(payload)

        self.assertTrue(valid, error)

    def test_non_path_object_with_real_path_data_is_rejected(self):
        payload = {
            "objects": [
                {
                    "type": "textbox",
                    "text": "Unsafe text path",
                    "path": [
                        ["M", 0, 0],
                        ["L", 100, 100],
                    ],
                    "fill": "#0f172a",
                }
            ],
        }

        valid, _error = self._validate(payload)

        self.assertFalse(valid)

    def test_board_list_pagination_returns_distinct_pages(self):
        boards = [
            self.Board.create({
                "name": "Pagination %s" % index,
            })
            for index in range(5)
        ]

        expected_ids = [
            board.id
            for board in reversed(boards)
        ]

        first_page = self.Board.get_user_boards(
            offset=0,
            limit=2,
        )

        second_page = self.Board.get_user_boards(
            offset=first_page["next_offset"],
            limit=2,
        )

        first_ids = [
            board["id"]
            for board in first_page["boards"]
        ]

        second_ids = [
            board["id"]
            for board in second_page["boards"]
        ]

        self.assertEqual(
            first_ids,
            expected_ids[:2],
        )

        self.assertEqual(
            second_ids,
            expected_ids[2:4],
        )

        self.assertFalse(
            set(first_ids)
            & set(second_ids)
        )

        self.assertTrue(
            first_page["has_more"],
        )

        self.assertTrue(
            second_page["has_more"],
        )

        self.assertEqual(
            second_page["next_offset"],
            4,
        )

    def test_board_list_returns_current_board_outside_page(self):
        oldest_board = self.Board.create({
            "name": "Old selected board",
        })

        newer_boards = [
            self.Board.create({
                "name": "New board %s" % index,
            })
            for index in range(3)
        ]

        result = self.Board.get_user_boards(
            offset=0,
            limit=2,
            current_board_id=oldest_board.id,
        )

        page_ids = [
            board["id"]
            for board in result["boards"]
        ]

        self.assertEqual(
            page_ids,
            [
                newer_boards[2].id,
                newer_boards[1].id,
            ],
        )

        self.assertNotIn(
            oldest_board.id,
            page_ids,
        )

        self.assertEqual(
            result["current_board"]["id"],
            oldest_board.id,
        )

        self.assertEqual(
            result["current_board"]["name"],
            "Old selected board",
        )

    def test_large_valid_thumbnail_is_resized(self):
        source_b64 = self._png_base64(
            width=1200,
            height=800,
        )

        valid, normalized = (
            self.Board._extract_thumbnail_base64(
                source_b64
            )
        )

        self.assertTrue(valid)

        normalized_bytes = base64.b64decode(
            normalized
        )

        with Image.open(
                BytesIO(normalized_bytes)
        ) as image:
            self.assertEqual(
                image.format,
                "JPEG",
            )

            self.assertLessEqual(
                image.width,
                NORMALIZED_THUMBNAIL_MAX_WIDTH,
            )

            self.assertLessEqual(
                image.height,
                NORMALIZED_THUMBNAIL_MAX_HEIGHT,
            )

            self.assertEqual(
                image.size,
                (480, 320),
            )

        self.assertLessEqual(
            len(normalized_bytes),
            NORMALIZED_THUMBNAIL_MAX_BYTES,
        )

    def test_direct_create_stores_normalized_thumbnail(self):
        source_b64 = self._png_base64(
            width=800,
            height=600,
        )

        board = self.Board.create({
            "name": "Normalized thumbnail",
            "thumbnail": source_b64,
        })

        stored_bytes = base64.b64decode(
            board.thumbnail
        )

        with Image.open(
                BytesIO(stored_bytes)
        ) as image:
            self.assertEqual(
                image.format,
                "JPEG",
            )

            self.assertLessEqual(
                image.width,
                NORMALIZED_THUMBNAIL_MAX_WIDTH,
            )

            self.assertLessEqual(
                image.height,
                NORMALIZED_THUMBNAIL_MAX_HEIGHT,
            )

        self.assertLessEqual(
            len(stored_bytes),
            NORMALIZED_THUMBNAIL_MAX_BYTES,
        )

    def test_board_name_is_normalized_on_direct_orm(self):
        board = self.Board.create({
            "name": "  Project \n  Plan\t ",
        })

        self.assertEqual(
            board.name,
            "Project Plan",
        )

        board.write({
            "name": "  Updated\t Board  ",
        })

        board.invalidate_recordset([
            "name",
        ])

        self.assertEqual(
            board.name,
            "Updated Board",
        )

    def test_board_name_length_limit_is_enforced_on_direct_orm(self):
        too_long_name = (
                "x"
                * (MAX_BOARD_NAME_LENGTH + 1)
        )

        with self.assertRaises(
                ValidationError
        ):
            self.Board.create({
                "name": too_long_name,
            })

        board = self.Board.create({
            "name": "Valid name",
        })

        with self.assertRaises(
                ValidationError
        ):
            board.write({
                "name": too_long_name,
            })

        board.invalidate_recordset([
            "name",
            "revision",
        ])

        self.assertEqual(
            board.name,
            "Valid name",
        )

        self.assertEqual(
            board.revision,
            0,
        )

    def test_create_board_validates_and_normalizes_name(self):
        normalized = self.Board.create_board(
            "  Release \n Board  "
        )

        self.assertNotIn(
            "error",
            normalized,
        )

        self.assertEqual(
            normalized["name"],
            "Release Board",
        )

        blank = self.Board.create_board(
            " \n\t "
        )

        self.assertNotIn(
            "error",
            blank,
        )

        self.assertEqual(
            blank["name"],
            "Untitled Board",
        )

        for invalid_name in (
                123,
                [],
                {},
        ):
            with self.subTest(
                    name=invalid_name
            ):
                result = self.Board.create_board(
                    invalid_name
                )

                self.assertIn(
                    "error",
                    result,
                )

    def test_save_rpc_rejects_invalid_name_without_write(self):
        board = self.Board.create({
            "name": "Protected name",
            "data_json": '{"objects":[]}',
        })

        original_data = board.data_json

        invalid_names = (
            123,
            [],
            {},
            (
                    "x"
                    * (MAX_BOARD_NAME_LENGTH + 1)
            ),
        )

        for invalid_name in invalid_names:
            with self.subTest(
                    name=invalid_name
            ):
                result = self.Board.save_my_board(
                    board.id,
                    (
                        '{"objects":['
                        '{"type":"rect","fill":"white"}'
                        ']}'
                    ),
                    None,
                    invalid_name,
                    0,
                )

                self.assertIn(
                    "error",
                    result,
                )

        board.invalidate_recordset([
            "name",
            "data_json",
            "revision",
        ])

        self.assertEqual(
            board.name,
            "Protected name",
        )

        self.assertEqual(
            board.data_json,
            original_data,
        )

        self.assertEqual(
            board.revision,
            0,
        )

    def test_save_rpc_normalizes_and_preserves_name(self):
        board = self.Board.create({
            "name": "Original name",
            "data_json": '{"objects":[]}',
        })

        renamed = self.Board.save_my_board(
            board.id,
            '{"objects":[]}',
            None,
            "  Updated \n Name  ",
            0,
        )

        self.assertTrue(
            renamed["ok"]
        )

        self.assertEqual(
            renamed["board"]["name"],
            "Updated Name",
        )

        preserved = self.Board.save_my_board(
            board.id,
            '{"objects":[]}',
            None,
            " \n\t ",
            1,
        )

        self.assertTrue(
            preserved["ok"]
        )

        self.assertEqual(
            preserved["board"]["name"],
            "Updated Name",
        )

        self.assertEqual(
            preserved["board"]["revision"],
            2,
        )