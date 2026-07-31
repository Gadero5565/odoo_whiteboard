from odoo.exceptions import AccessError, ValidationError
from odoo.tests.common import TransactionCase


class TestWhiteboardAccessControl(TransactionCase):

    def setUp(self):
        super().setUp()

        internal_user_group = self.env.ref("base.group_user")
        company = self.env.company

        self.user_a = self.env["res.users"].with_context(
            no_reset_password=True,
        ).create({
            "name": "Whiteboard User A",
            "login": "whiteboard_phase_1c_user_a",
            "email": "whiteboard-phase-1c-a@example.invalid",
            "company_id": company.id,
            "company_ids": [(6, 0, [company.id])],
            "groups_id": [(6, 0, [internal_user_group.id])],
        })

        self.user_b = self.env["res.users"].with_context(
            no_reset_password=True,
        ).create({
            "name": "Whiteboard User B",
            "login": "whiteboard_phase_1c_user_b",
            "email": "whiteboard-phase-1c-b@example.invalid",
            "company_id": company.id,
            "company_ids": [(6, 0, [company.id])],
            "groups_id": [(6, 0, [internal_user_group.id])],
        })

        self.Board = self.env["whiteboard.board"]
        self.BoardA = self.Board.with_user(self.user_a)
        self.BoardB = self.Board.with_user(self.user_b)

    def _create_board_a(self, name="User A board"):
        return self.BoardA.create({"name": name})

    def _create_board_b(self, name="User B board"):
        return self.BoardB.create({"name": name})

    def test_record_rule_hides_other_users_board(self):
        board_a = self._create_board_a()
        board_b = self._create_board_b()

        visible_to_a = self.BoardA.search([
            ("id", "in", [board_a.id, board_b.id]),
        ])

        self.assertEqual(visible_to_a, board_a)

        with self.assertRaises(AccessError):
            self.BoardA.browse(board_b.id).read(["name"])

    def test_other_users_board_cannot_be_written_or_deleted(self):
        board_b = self._create_board_b()
        foreign_board = self.BoardA.browse(board_b.id)

        with self.assertRaises(AccessError):
            foreign_board.write({"name": "Taken over"})

        with self.assertRaises(AccessError):
            foreign_board.unlink()

        board_b_sudo = self.Board.sudo().browse(board_b.id)

        self.assertTrue(board_b_sudo.exists())
        self.assertEqual(board_b_sudo.name, "User B board")
        self.assertEqual(board_b_sudo.user_id.id, self.user_b.id)

    def test_client_provided_user_id_is_ignored_on_create_and_write(self):
        board = self.BoardA.create({
            "name": "Forced owner",
            "user_id": self.user_b.id,
        })

        self.assertEqual(board.user_id.id, self.user_a.id)

        board.write({
            "name": "Still owned by A",
            "user_id": self.user_b.id,
        })

        self.assertEqual(board.name, "Still owned by A")
        self.assertEqual(board.user_id.id, self.user_a.id)

    def test_board_list_returns_only_current_users_boards(self):
        board_a = self._create_board_a()
        board_b = self._create_board_b()

        result = self.BoardA.get_user_boards()

        board_ids = {
            item["id"]
            for item in result["boards"]
        }

        self.assertIn(
            board_a.id,
            board_ids,
        )

        self.assertNotIn(
            board_b.id,
            board_ids,
        )

    def test_latest_board_rpc_never_returns_another_users_board(self):
        board_b = self._create_board_b()

        payload = self.BoardA.get_or_create_latest_board()
        board_a = self.Board.sudo().browse(payload["id"])

        self.assertNotEqual(board_a.id, board_b.id)
        self.assertEqual(board_a.user_id.id, self.user_a.id)

    def test_get_board_data_denies_foreign_board(self):
        board_b = self._create_board_b()

        result = self.BoardA.get_board_data(board_b.id)

        self.assertIn("error", result)
        self.assertNotIn("data_json", result)

    def test_get_board_data_denies_invalid_ids(self):
        for invalid_id in (
                None,
                False,
                True,
                0,
                -1,
                1.5,
                "1.5",
                "not-an-id",
                [],
                {},
                2_147_483_647,
        ):
            with self.subTest(board_id=invalid_id):
                result = self.BoardA.get_board_data(invalid_id)

                self.assertIn("error", result)

    def test_get_board_data_denies_archived_board(self):
        board_a = self._create_board_a()
        board_a.write({"active": False})

        result = self.BoardA.get_board_data(board_a.id)

        self.assertIn("error", result)

    def test_save_rpc_cannot_modify_another_users_board(self):
        board_b = self.BoardB.create({
            "name": "Protected board",
            "data_json": '{"objects":[]}',
        })
        original_data = board_b.data_json

        result = self.BoardA.save_my_board(
            board_b.id,
            '{"objects":[{"type":"rect","fill":"white"}]}',
            None,
            "Attacker rename",
            board_b.revision,
        )

        self.assertIn("error", result)

        board_b_sudo = self.Board.sudo().browse(board_b.id)

        self.assertEqual(board_b_sudo.name, "Protected board")
        self.assertEqual(board_b_sudo.data_json, original_data)
        self.assertEqual(board_b_sudo.user_id.id, self.user_b.id)

    def test_save_rpc_denies_invalid_board_ids(self):
        for invalid_id in (
                None,
                False,
                True,
                0,
                -1,
                1.5,
                "1.5",
                "not-an-id",
                [],
                {},
                2_147_483_647,
        ):
            with self.subTest(board_id=invalid_id):
                result = self.BoardA.save_my_board(
                    invalid_id,
                    '{"objects":[]}',
                    None,
                    None,
                    0,
                )

                self.assertIn("error", result)

    def test_save_rpc_denies_archived_board(self):
        board_a = self.BoardA.create({
            "name": "Archived board",
            "data_json": '{"objects":[]}',
        })
        original_data = board_a.data_json

        board_a.write({"active": False})

        result = self.BoardA.save_my_board(
            board_a.id,
            '{"objects":[{"type":"rect","fill":"white"}]}',
            None,
            "Archived rename",
            board_a.revision,
        )

        self.assertIn("error", result)

        board_a_sudo = self.Board.sudo().with_context(
            active_test=False,
        ).browse(board_a.id)

        self.assertFalse(board_a_sudo.active)
        self.assertEqual(board_a_sudo.name, "Archived board")
        self.assertEqual(board_a_sudo.data_json, original_data)

    def test_direct_write_cannot_save_archived_board_content(self):
        board_a = self.BoardA.create({
            "name": "Archived direct-write board",
            "data_json": '{"objects":[]}',
        })
        board_a.write({"active": False})

        archived_board = self.BoardA.with_context(
            active_test=False,
        ).browse(board_a.id)

        with self.assertRaises(ValidationError):
            archived_board.write({
                "data_json": (
                    '{"objects":[{"type":"rect","fill":"white"}]}'
                ),
            })

        archived_board_sudo = self.Board.sudo().with_context(
            active_test=False,
        ).browse(board_a.id)

        self.assertEqual(
            archived_board_sudo.data_json,
            '{"objects":[]}',
        )

    def test_archived_board_can_be_reactivated(self):
        board_a = self._create_board_a()
        board_a.write({"active": False})

        archived_board = self.BoardA.with_context(
            active_test=False,
        ).browse(board_a.id)

        archived_board.write({"active": True})

        self.assertTrue(archived_board.active)

    def test_public_open_action_enforces_record_rule(self):
        board_b = self._create_board_b()

        with self.assertRaises(AccessError):
            self.BoardA.browse(
                board_b.id
            ).action_open_whiteboard()

    def test_owner_can_load_save_and_open_own_board(self):
        board_a = self._create_board_a()

        load_result = self.BoardA.get_board_data(board_a.id)

        self.assertEqual(load_result["id"], board_a.id)

        save_result = self.BoardA.save_my_board(
            board_a.id,
            '{"objects":[]}',
            None,
            "Owner update",
            board_a.revision,
        )

        self.assertTrue(save_result["ok"])
        self.assertEqual(
            save_result["board"]["name"],
            "Owner update",
        )

        action = board_a.action_open_whiteboard()

        self.assertEqual(
            action["params"]["board_id"],
            board_a.id,
        )

    def test_board_list_cannot_include_foreign_current_board(self):
        board_a = self._create_board_a()
        board_b = self._create_board_b()

        result = self.BoardA.get_user_boards(
            offset=0,
            limit=1,
            current_board_id=board_b.id,
        )

        returned_ids = {
            board["id"]
            for board in result["boards"]
        }

        self.assertIn(
            board_a.id,
            returned_ids,
        )

        self.assertNotIn(
            board_b.id,
            returned_ids,
        )

        self.assertFalse(
            result["current_board"],
        )

    def test_client_provided_company_is_ignored_on_create_and_write(self):
        other_company = self.env[
            "res.company"
        ].create({
            "name": "Whiteboard Other Company",
            "currency_id": (
                self.env.company.currency_id.id
            ),
        })

        board = self.BoardA.create({
            "name": "Company protected board",
            "company_id": other_company.id,
        })

        self.assertEqual(
            board.company_id.id,
            self.user_a.company_id.id,
        )

        original_revision = board.revision

        board.write({
            "company_id": other_company.id,
        })

        board.invalidate_recordset([
            "company_id",
            "revision",
        ])

        self.assertEqual(
            board.company_id.id,
            self.user_a.company_id.id,
        )

        self.assertEqual(
            board.revision,
            original_revision,
        )