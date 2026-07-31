from odoo.tests.common import TransactionCase


class TestWhiteboardOptimisticConcurrency(
        TransactionCase,
):

    def setUp(self):
        super().setUp()

        self.Board = self.env["whiteboard.board"]

    def test_create_ignores_client_revision(self):
        board = self.Board.create({
            "name": "Revision test",
            "revision": 999,
        })

        self.assertEqual(
            board.revision,
            0,
        )

        payload = self.Board.get_board_data(
            board.id
        )

        self.assertEqual(
            payload["revision"],
            0,
        )

    def test_successful_save_increments_revision(self):
        board = self.Board.create({
            "name": "Revision save",
        })

        result = self.Board.save_my_board(
            board.id,
            '{"objects":[]}',
            None,
            "Revision save updated",
            0,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(
            result["board"]["revision"],
            1,
        )

        board.invalidate_recordset([
            "revision",
            "name",
            "data_json",
        ])

        self.assertEqual(
            board.revision,
            1,
        )
        self.assertEqual(
            board.name,
            "Revision save updated",
        )

    def test_stale_save_is_rejected_without_overwrite(
            self,
    ):
        board = self.Board.create({
            "name": "Original board",
            "data_json": '{"objects":[]}',
        })

        first_payload = (
            '{"objects":['
            '{"type":"rect","fill":"white"}'
            ']}'
        )

        first_save = self.Board.save_my_board(
            board.id,
            first_payload,
            None,
            "First tab",
            0,
        )

        self.assertTrue(first_save["ok"])
        self.assertEqual(
            first_save["board"]["revision"],
            1,
        )

        stale_payload = (
            '{"objects":['
            '{"type":"circle","fill":"white"}'
            ']}'
        )

        stale_save = self.Board.save_my_board(
            board.id,
            stale_payload,
            None,
            "Stale second tab",
            0,
        )

        self.assertIn("error", stale_save)
        self.assertTrue(
            stale_save["conflict"]
        )
        self.assertEqual(
            stale_save["current_revision"],
            1,
        )

        board.invalidate_recordset([
            "revision",
            "name",
            "data_json",
        ])

        self.assertEqual(
            board.revision,
            1,
        )
        self.assertEqual(
            board.name,
            "First tab",
        )
        self.assertEqual(
            board.data_json,
            first_payload,
        )

    def test_invalid_expected_revision_is_rejected(
            self,
    ):
        board = self.Board.create({
            "name": "Invalid revision",
        })

        invalid_revisions = (
            None,
            False,
            -1,
            "0",
            0.0,
        )

        for invalid_revision in invalid_revisions:
            with self.subTest(
                    revision=invalid_revision,
            ):
                result = self.Board.save_my_board(
                    board.id,
                    '{"objects":[]}',
                    None,
                    None,
                    invalid_revision,
                )

                self.assertIn(
                    "error",
                    result,
                )
                self.assertNotIn(
                    "ok",
                    result,
                )

        board.invalidate_recordset([
            "revision",
            "name",
            "data_json",
        ])

        self.assertEqual(
            board.revision,
            0,
        )

    def test_direct_content_write_increments_revision(
            self,
    ):
        board = self.Board.create({
            "name": "Direct write",
        })

        self.assertEqual(
            board.revision,
            0,
        )

        board.write({
            "name": "Direct write updated",
        })

        self.assertEqual(
            board.revision,
            1,
        )

        board.write({
            "data_json": '{"objects":[]}',
        })

        self.assertEqual(
            board.revision,
            2,
        )

    def test_direct_write_cannot_force_revision(
            self,
    ):
        board = self.Board.create({
            "name": "Protected revision",
        })

        board.write({
            "name": "Protected revision updated",
            "revision": 999,
        })

        self.assertEqual(
            board.revision,
            1,
        )