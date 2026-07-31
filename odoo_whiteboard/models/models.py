from odoo import api, fields, models, _
from odoo.exceptions import ValidationError
from PIL import Image, ImageOps, UnidentifiedImageError
import base64
from io import BytesIO
import json
import math
import re
import warnings


MAX_JSON_BYTES = 2 * 1024 * 1024             # 2 MB
MAX_THUMBNAIL_BYTES = 512 * 1024
MAX_THUMBNAIL_ENCODED_CHARS = 750_000
MAX_THUMBNAIL_WIDTH = 2048
MAX_THUMBNAIL_HEIGHT = 2048
MAX_THUMBNAIL_PIXELS = 2_000_000

NORMALIZED_THUMBNAIL_MAX_WIDTH = 480
NORMALIZED_THUMBNAIL_MAX_HEIGHT = 320
NORMALIZED_THUMBNAIL_MAX_BYTES = 160 * 1024
NORMALIZED_THUMBNAIL_JPEG_QUALITIES = (
    78,
    68,
    58,
    48,
    38,
)

MAX_BOARDS_PER_USER = 100
MAX_BOARD_NAME_LENGTH = 120

DEFAULT_BOARD_PAGE_SIZE = 25
MAX_BOARD_LIST_RESULTS = 50

MAX_CANVAS_OBJECTS = 1000
MAX_GROUP_DEPTH = 3
MAX_JSON_DEPTH = 12
MAX_TEXT_LENGTH = 10_000
MAX_TOTAL_TEXT_LENGTH = 100_000
MAX_PATH_COMMANDS = 20_000
MAX_TOTAL_PATH_COMMANDS = 50_000
MAX_POLYGON_POINTS = 2_000
MAX_COLLECTION_ITEMS = 20_000
MAX_ABS_NUMBER = 100_000
MAX_SCALE = 100
MAX_STROKE_WIDTH = 200
MAX_FONT_SIZE = 1_000
MAX_STRING_LENGTH = 100_000
MAX_IDENTIFIER_LENGTH = 160

ALLOWED_FABRIC_TYPES = frozenset({
    "path", "i-text", "rect", "circle", "polygon", "line", "group", "textbox",
})
ALLOWED_PATH_COMMANDS = frozenset(
    "MLHVCSQTAZmlhvcsqtaz"
)
FORBIDDEN_JSON_KEYS = frozenset({"__proto__", "prototype", "constructor"})
FORBIDDEN_FABRIC_KEYS = frozenset({
    "src", "source", "sourcePath", "crossOrigin", "filters",
    "resizeFilter", "clipPath", "backgroundImage", "overlayImage",
})
COLOR_KEYS = frozenset({"fill", "stroke", "backgroundColor", "textBackgroundColor"})
WHITEBOARD_ENUMS = {
    "wbType": frozenset({"shape", "connector", "mind_node", "flow_node"}),
    "wbShape": frozenset({
        "rectangle", "circle", "diamond", "line", "arrow", "mind_node", "flow_node",
    }),
    "wbRole": frozenset({"node_background", "node_text"}),
    "wbNodeType": frozenset({
        "mind_node", "terminator", "process", "decision", "data",
    }),
    "wbConnectorType": frozenset({
        "straight_arrow", "template_arrow", "mind_arrow",
    }),
}

ALLOWED_THUMBNAIL_FORMATS = frozenset({"PNG", "JPEG", "WEBP"})

THUMBNAIL_MIME_FORMATS = {
    "png": "PNG",
    "jpg": "JPEG",
    "jpeg": "JPEG",
    "webp": "WEBP",
}


class WhiteboardBoard(models.Model):
    _name = "whiteboard.board"
    _description = "Whiteboard Board"
    _order = "write_date desc, id desc"

    name = fields.Char(
        required=True,
        default=lambda self: _("My Whiteboard"),
    )

    user_id = fields.Many2one(
        "res.users",
        required=True,
        default=lambda self: self.env.user,
        index=True,
        copy=False,
    )

    company_id = fields.Many2one(
        "res.company",
        default=lambda self: self.env.company,
        index=True,
        copy=False,
    )

    active = fields.Boolean(default=True)

    revision = fields.Integer(
        default=0,
        required=True,
        readonly=True,
        copy=False,
    )

    data_json = fields.Text()

    thumbnail = fields.Binary(
        attachment=True,
        copy=False,
    )

    # -------------------------------------------------------------------------
    # Ownership hardening
    # -------------------------------------------------------------------------

    @api.model_create_multi
    def create(self, vals_list):
        """
        Force board ownership to the current user.

        Do not trust user_id coming from the client, XML context, RPC, import, etc.
        Each user creates boards only for himself.
        """
        self._check_board_creation_quota(len(vals_list))
        prepared_vals_list = []

        for vals in vals_list:
            vals = dict(vals)

            # Ownership, company, and concurrency metadata are always
            # controlled by the server, never by RPC or imported values.
            vals["user_id"] = self.env.uid
            vals["company_id"] = self.env.company.id
            vals["revision"] = 0

            if "name" in vals:
                vals["name"] = self._validated_board_name(
                    vals["name"],
                    default=_("Untitled Board"),
                )

            if "data_json" in vals:
                vals["data_json"] = self._validated_data_json(
                    vals["data_json"]
                )

            if "thumbnail" in vals:
                vals["thumbnail"] = self._validated_thumbnail(
                    vals["thumbnail"]
                )

            prepared_vals_list.append(vals)

        return super().create(prepared_vals_list)

    def write(self, vals):
        """
        Prevent ownership and revision reassignment, validate direct ORM
        writes, and increment the board revision whenever saved content
        changes.

        Archived boards may be reactivated or deleted, but their saved
        content cannot be changed while they remain archived.
        """
        vals = dict(vals)

        # These fields are always server-controlled.
        vals.pop("user_id", None)
        vals.pop("company_id", None)
        vals.pop("revision", None)

        saved_content_fields = {
            "name",
            "data_json",
            "thumbnail",
        }
        changes_saved_content = bool(
            saved_content_fields.intersection(vals)
        )

        if changes_saved_content:
            self.check_access_rights("write")
            self.check_access_rule("write")

        if "name" in vals:
            vals["name"] = self._validated_board_name(
                vals["name"]
            )

        if "data_json" in vals:
            vals["data_json"] = self._validated_data_json(
                vals["data_json"]
            )

        if "thumbnail" in vals:
            vals["thumbnail"] = self._validated_thumbnail(
                vals["thumbnail"]
            )

        if not changes_saved_content:
            return self._write_validated_vals(vals)

        for board in self:
            # ORM updates can be deferred. Flush the fields used by the
            # raw SQL query before reading and locking the database row.
            board.flush_recordset([
                "revision",
                "active",
            ])

            self.env.cr.execute(
                """
                    SELECT revision, active
                      FROM whiteboard_board
                     WHERE id = %s
                     FOR UPDATE
                """,
                [board.id],
            )
            row = self.env.cr.fetchone()

            if not row:
                raise ValidationError(
                    _("Whiteboard no longer exists.")
                )

            current_revision, is_active = row

            if not is_active:
                raise ValidationError(
                    _("Archived whiteboards cannot be modified.")
                )

            board_vals = dict(vals)
            board_vals["revision"] = (
                                             current_revision or 0
                                     ) + 1

            board._write_validated_vals(board_vals)

        return True

    def _write_validated_vals(self, vals):
        return super().write(vals)

    # -------------------------------------------------------------------------
    # Helpers
    # -------------------------------------------------------------------------

    @api.model
    def _validate_board_name(
            self,
            name,
            default=None,
    ):
        """
        Validate and normalize an untrusted whiteboard name.

        Internal whitespace is collapsed so newlines, tabs, and repeated
        spaces cannot create malformed selector entries.
        """
        if name is None or name is False:
            if default is not None:
                return True, default

            return (
                False,
                _("Whiteboard name is required."),
            )

        if not isinstance(name, str):
            return (
                False,
                _("Whiteboard name must be text."),
            )

        clean_name = " ".join(
            name.split()
        )

        if not clean_name:
            if default is not None:
                return True, default

            return (
                False,
                _("Whiteboard name is required."),
            )

        if len(clean_name) > MAX_BOARD_NAME_LENGTH:
            return (
                False,
                _(
                    "Whiteboard name cannot exceed "
                    "%s characters."
                )
                % MAX_BOARD_NAME_LENGTH,
            )

        return True, clean_name

    @api.model
    def _validated_board_name(
            self,
            name,
            default=None,
    ):
        valid, result = self._validate_board_name(
            name,
            default=default,
        )

        if not valid:
            raise ValidationError(result)

        return result

    @api.model
    def _check_board_creation_quota(self, requested_count):
        if not requested_count:
            return

        # Serialize creation for the current user so concurrent requests
        # cannot bypass the per-user quota.
        self.env.cr.execute(
            "SELECT id FROM res_users WHERE id = %s FOR UPDATE",
            [self.env.uid],
        )

        existing_count = (
            self.sudo()
            .with_context(active_test=False)
            .search_count([
                ("user_id", "=", self.env.uid),
            ])
        )

        if existing_count + requested_count > MAX_BOARDS_PER_USER:
            raise ValidationError(
                _(
                    "You can create up to %s whiteboards. "
                    "Delete an existing board before creating another."
                )
                % MAX_BOARDS_PER_USER
            )

    @api.model
    def _normalize_board_id(self, board_id):
        """
        Accept only positive integer IDs or decimal integer strings.

        Do not use int() directly on arbitrary values because:
        - True becomes 1
        - 1.5 becomes 1
        """
        if isinstance(board_id, bool):
            return False

        if isinstance(board_id, int):
            normalized_id = board_id

        elif isinstance(board_id, str):
            clean_id = board_id.strip()

            if not re.fullmatch(
                    r"[1-9][0-9]*",
                    clean_id,
            ):
                return False

            try:
                normalized_id = int(clean_id)
            except (TypeError, ValueError):
                return False

        else:
            return False

        if normalized_id <= 0:
            return False

        return normalized_id

    def _get_current_user_board(self, board_id):
        normalized_board_id = (
            self._normalize_board_id(
                board_id
            )
        )

        if not normalized_board_id:
            return self.browse()

        return self.search(
            [
                (
                    "id",
                    "=",
                    normalized_board_id,
                ),
                (
                    "user_id",
                    "=",
                    self.env.uid,
                ),
                (
                    "active",
                    "=",
                    True,
                ),
            ],
            limit=1,
        )

    def _board_payload(self, board):
        board.ensure_one()

        return {
            "id": board.id,
            "name": board.name,
            "data_json": board.data_json or False,
            "revision": board.revision,
            "write_date": (
                fields.Datetime.to_string(board.write_date)
                if board.write_date
                else False
            ),
        }

    def _board_list_item(self, board):
        board.ensure_one()

        return {
            "id": board.id,
            "name": board.name,
            "write_date": (
                fields.Datetime.to_string(
                    board.write_date
                )
                if board.write_date
                else False
            ),
        }

    @api.model
    def _normalize_board_page_integer(
            self,
            value,
            default,
            minimum,
            maximum,
    ):
        """
        Normalize untrusted pagination values received through RPC.

        Boolean values are rejected explicitly because bool is a
        subclass of int in Python.
        """
        if isinstance(value, bool):
            return default

        try:
            normalized = int(value)
        except (TypeError, ValueError):
            return default

        return max(
            minimum,
            min(normalized, maximum),
        )

    @api.model
    def _validate_expected_revision(self, expected_revision):
        """
        Validate the revision supplied by the client.

        Boolean values must be rejected explicitly because bool is a
        subclass of int in Python.
        """
        if (
                isinstance(expected_revision, bool)
                or not isinstance(expected_revision, int)
                or expected_revision < 0
        ):
            return (
                False,
                _("Whiteboard revision is missing or invalid."),
            )

        return True, expected_revision

    def _validated_data_json(self, data_json):
        valid, result = self._validate_data_json(data_json)
        if not valid:
            raise ValidationError(result)
        return result

    def _validate_data_json(self, data_json):
        if data_json is None or data_json is False:
            data_json = "{}"

        if not isinstance(data_json, str):
            return False, _("Whiteboard data must be a JSON string.")

        if len(data_json.encode("utf-8")) > MAX_JSON_BYTES:
            return False, _("Whiteboard is too large to save.")

        def reject_constant(_value):
            raise ValueError("Non-finite JSON number")

        def reject_duplicate_keys(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("Duplicate JSON key")
                result[key] = value
            return result

        try:
            parsed = json.loads(
                data_json or "{}",
                parse_constant=reject_constant,
                object_pairs_hook=reject_duplicate_keys,
            )
        except (TypeError, ValueError, RecursionError):
            return False, _("Whiteboard data is not valid JSON.")

        if not isinstance(parsed, dict):
            return False, _("Whiteboard data must be a JSON object.")

        error = self._validate_canvas_payload(parsed)
        if error:
            return False, error

        return True, json.dumps(
            parsed,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        )

    def _validate_canvas_payload(self, payload):
        if set(payload) - {"version", "objects", "background"}:
            return _("Whiteboard data contains unsupported canvas properties.")

        version = payload.get("version")
        if version is not None and (not isinstance(version, str) or len(version) > 40):
            return _("Whiteboard Fabric version is invalid.")

        background = payload.get("background")
        if background is not None and not self._is_safe_color(background):
            return _("Whiteboard background must be a plain color.")

        objects = payload.get("objects", [])
        if not isinstance(objects, list):
            return _("Whiteboard objects must be a JSON array.")

        state = {"objects": 0, "text": 0, "path_commands": 0}
        for obj in objects:
            error = self._validate_fabric_object(obj, state, group_depth=0)
            if error:
                return error

        return False

    def _validate_fabric_object(self, obj, state, group_depth):
        if not isinstance(obj, dict):
            return _("Each whiteboard object must be a JSON object.")

        state["objects"] += 1
        if state["objects"] > MAX_CANVAS_OBJECTS:
            return _("Whiteboard contains too many objects.")

        object_type = obj.get("type")
        if object_type not in ALLOWED_FABRIC_TYPES:
            return _("Unsupported whiteboard object type: %s") % (object_type or _("missing"))

        for key, allowed_values in WHITEBOARD_ENUMS.items():
            value = obj.get(key)
            if value is not None and value not in allowed_values:
                return _("Whiteboard object metadata is invalid.")

        for key in ("wbId", "wbParentNodeId", "wbFromNodeId", "wbToNodeId"):
            value = obj.get(key)
            if value is not None and (
                not isinstance(value, str) or len(value) > MAX_IDENTIFIER_LENGTH
            ):
                return _("Whiteboard object metadata is invalid.")

        wb_text = obj.get("wbText")
        if wb_text is not None and (
            not isinstance(wb_text, str) or len(wb_text) > MAX_TEXT_LENGTH
        ):
            return _("Whiteboard object metadata is invalid.")

        expected_types = {
            "rectangle": "rect",
            "circle": "circle",
            "diamond": "polygon",
            "line": "line",
            "arrow": "path",
            "mind_node": "group",
            "flow_node": "group",
        }
        wb_shape = obj.get("wbShape")
        if wb_shape and object_type != expected_types[wb_shape]:
            return _("Whiteboard object type does not match its metadata.")

        if obj.get("wbType") == "connector" and (
            object_type != "path"
            or not obj.get("wbFromNodeId")
            or not obj.get("wbToNodeId")
        ):
            return _("Whiteboard connector metadata is invalid.")

        for key, value in obj.items():
            if key in {"scaleX", "scaleY"} and value is not None and (
                not self._is_safe_number(value) or abs(value) > MAX_SCALE
            ):
                return _("Whiteboard object scale is invalid.")
            if key == "strokeWidth" and value is not None and (
                not self._is_safe_number(value) or not 0 <= value <= MAX_STROKE_WIDTH
            ):
                return _("Whiteboard stroke width is invalid.")
            if key == "fontSize" and value is not None and (
                not self._is_safe_number(value) or not 0 < value <= MAX_FONT_SIZE
            ):
                return _("Whiteboard font size is invalid.")
            if key == "opacity" and value is not None and (
                not self._is_safe_number(value) or not 0 <= value <= 1
            ):
                return _("Whiteboard opacity is invalid.")
            if key in FORBIDDEN_JSON_KEYS:
                return _("Whiteboard data contains an unsafe property.")
            if key in FORBIDDEN_FABRIC_KEYS:
                return _("Whiteboard data contains unsupported external content.")
            if key == "path" and object_type != "path" and value is not None:
                return _("Whiteboard object contains unsupported path data.")
            if key == "points" and object_type != "polygon":
                return _("Whiteboard object contains unsupported polygon data.")
            if key in {"objects", "path", "points"}:
                continue
            error = self._validate_json_value(value, key=key, depth=0)
            if error:
                return error

        if object_type in {"i-text", "textbox"}:
            text = obj.get("text", "")
            if not isinstance(text, str) or len(text) > MAX_TEXT_LENGTH:
                return _("A whiteboard text object is invalid or too long.")
            state["text"] += len(text)
            if state["text"] > MAX_TOTAL_TEXT_LENGTH:
                return _("Whiteboard contains too much text.")

        if object_type == "path":
            error = self._validate_path(obj.get("path"), state)
            if error:
                return error

        if object_type == "polygon":
            error = self._validate_polygon_points(obj.get("points"))
            if error:
                return error

        children = obj.get("objects")
        if object_type == "group":
            if group_depth >= MAX_GROUP_DEPTH:
                return _("Whiteboard groups are nested too deeply.")
            if not isinstance(children, list) or not children:
                return _("Whiteboard group objects are invalid.")
            for child in children:
                error = self._validate_fabric_object(child, state, group_depth + 1)
                if error:
                    return error
        elif children is not None:
            return _("Only whiteboard groups may contain child objects.")

        return False

    def _validate_path(self, path, state):
        if not isinstance(path, list) or len(path) > MAX_PATH_COMMANDS:
            return _("Whiteboard path data is invalid or too complex.")

        state["path_commands"] += len(path)
        if state["path_commands"] > MAX_TOTAL_PATH_COMMANDS:
            return _("Whiteboard drawing paths are too complex.")

        for command in path:
            if (
                not isinstance(command, list)
                or not command
                or command[0] not in ALLOWED_PATH_COMMANDS
                or len(command) > 8
            ):
                return _("Whiteboard path data is invalid.")
            for number in command[1:]:
                if not self._is_safe_number(number):
                    return _("Whiteboard path data contains an invalid number.")

        return False

    def _validate_polygon_points(self, points):
        if not isinstance(points, list) or not points or len(points) > MAX_POLYGON_POINTS:
            return _("Whiteboard polygon points are invalid.")

        for point in points:
            if (
                not isinstance(point, dict)
                or set(point) != {"x", "y"}
                or not all(self._is_safe_number(value) for value in point.values())
            ):
                return _("Whiteboard polygon points are invalid.")

        return False

    def _validate_json_value(self, value, key=None, depth=0):
        if depth > MAX_JSON_DEPTH:
            return _("Whiteboard data is nested too deeply.")

        if key in COLOR_KEYS and value is not None and not self._is_safe_color(value):
            return _("Whiteboard colors must be plain color values.")

        if value is None or isinstance(value, bool):
            return False

        if isinstance(value, str):
            if len(value) > MAX_STRING_LENGTH:
                return _("Whiteboard contains a string value that is too long.")
            return False

        if isinstance(value, (int, float)):
            return False if self._is_safe_number(value) else _("Whiteboard contains an invalid number.")

        if isinstance(value, (list, dict)) and len(value) > MAX_COLLECTION_ITEMS:
            return _("Whiteboard contains an oversized collection.")

        if isinstance(value, list):
            for item in value:
                error = self._validate_json_value(item, depth=depth + 1)
                if error:
                    return error
            return False

        if isinstance(value, dict):
            for child_key, item in value.items():
                if child_key in FORBIDDEN_JSON_KEYS:
                    return _("Whiteboard data contains an unsafe property.")
                if child_key in FORBIDDEN_FABRIC_KEYS:
                    return _("Whiteboard data contains unsupported external content.")
                error = self._validate_json_value(
                    item,
                    key=child_key,
                    depth=depth + 1,
                )
                if error:
                    return error
            return False

        return _("Whiteboard data contains an unsupported value.")

    @api.model
    def _is_safe_number(self, value):
        return (
            not isinstance(value, bool)
            and isinstance(value, (int, float))
            and math.isfinite(value)
            and abs(value) <= MAX_ABS_NUMBER
        )

    @api.model
    def _is_safe_color(self, value):
        if not isinstance(value, str) or len(value) > 100:
            return False
        normalized = value.strip().lower()
        return not (
            re.match(r"^url\s*\(", normalized)
            or normalized.startswith("data:")
            or "://" in normalized
        )

    def _validated_thumbnail(self, thumbnail_value):
        valid, result = self._extract_thumbnail_base64(
            thumbnail_value
        )

        if not valid:
            raise ValidationError(result)

        return result

    def _normalize_thumbnail_image(self, decoded):
        """
        Convert a validated thumbnail to a compact JPEG preview.

        Every accepted input format is normalized so direct ORM and RPC
        callers cannot store unnecessarily large thumbnail files.
        """
        try:
            with warnings.catch_warnings():
                warnings.simplefilter(
                    "error",
                    Image.DecompressionBombWarning,
                )

                with Image.open(BytesIO(decoded)) as source_image:
                    image = ImageOps.exif_transpose(
                        source_image
                    )

                    resampling = getattr(
                        Image,
                        "Resampling",
                        Image,
                    )

                    image.thumbnail(
                        (
                            NORMALIZED_THUMBNAIL_MAX_WIDTH,
                            NORMALIZED_THUMBNAIL_MAX_HEIGHT,
                        ),
                        resampling.LANCZOS,
                    )

                    # JPEG has no alpha channel. Composite transparent
                    # images onto the white whiteboard background.
                    if (
                            image.mode in {"RGBA", "LA"}
                            or "transparency" in image.info
                    ):
                        rgba_image = image.convert("RGBA")

                        normalized_image = Image.new(
                            "RGB",
                            rgba_image.size,
                            color="white",
                        )

                        normalized_image.paste(
                            rgba_image,
                            mask=rgba_image.getchannel("A"),
                        )
                    else:
                        normalized_image = image.convert("RGB")

                    for quality in (
                            NORMALIZED_THUMBNAIL_JPEG_QUALITIES
                    ):
                        output = BytesIO()

                        normalized_image.save(
                            output,
                            format="JPEG",
                            quality=quality,
                            optimize=True,
                            progressive=True,
                        )

                        normalized_bytes = output.getvalue()

                        if (
                                len(normalized_bytes)
                                <= NORMALIZED_THUMBNAIL_MAX_BYTES
                        ):
                            return True, base64.b64encode(
                                normalized_bytes
                            ).decode("ascii")

        except (
                Image.DecompressionBombError,
                Image.DecompressionBombWarning,
                UnidentifiedImageError,
                OSError,
                ValueError,
        ):
            return False, _(
                "Thumbnail could not be normalized."
            )

        return False, _(
            "Thumbnail could not be reduced to a safe size."
        )

    def _extract_thumbnail_base64(self, thumbnail_value):
        if not thumbnail_value:
            return True, False

        if isinstance(thumbnail_value, bytes):
            try:
                thumbnail_value = thumbnail_value.decode(
                    "ascii"
                )
            except UnicodeDecodeError:
                return False, _(
                    "Thumbnail data is invalid."
                )

        if not isinstance(thumbnail_value, str):
            return False, _(
                "Thumbnail data is invalid."
            )

        if (
                len(thumbnail_value)
                > MAX_THUMBNAIL_ENCODED_CHARS
        ):
            return False, _(
                "Thumbnail is too large."
            )

        declared_format = None

        data_url_match = re.fullmatch(
            (
                r"data:image/(png|jpg|jpeg|webp);"
                r"base64,([A-Za-z0-9+/=\s]+)"
            ),
            thumbnail_value,
            flags=re.IGNORECASE,
        )

        if data_url_match:
            declared_format = THUMBNAIL_MIME_FORMATS[
                data_url_match.group(1).lower()
            ]

            thumbnail_b64 = (
                data_url_match.group(2)
            )
        else:
            if (
                    thumbnail_value
                            .lstrip()
                            .lower()
                            .startswith("data:")
            ):
                return False, _(
                    "Thumbnail must be a supported "
                    "base64 image."
                )

            thumbnail_b64 = thumbnail_value

        thumbnail_b64 = re.sub(
            r"\s+",
            "",
            thumbnail_b64,
        )

        if not thumbnail_b64:
            return False, _(
                "Thumbnail data is invalid."
            )

        try:
            decoded = base64.b64decode(
                thumbnail_b64,
                validate=True,
            )
        except (TypeError, ValueError):
            return False, _(
                "Thumbnail base64 data is invalid."
            )

        if len(decoded) > MAX_THUMBNAIL_BYTES:
            return False, _(
                "Thumbnail is too large."
            )

        try:
            with warnings.catch_warnings():
                warnings.simplefilter(
                    "error",
                    Image.DecompressionBombWarning,
                )

                with Image.open(
                        BytesIO(decoded)
                ) as image:
                    image_format = image.format
                    width, height = image.size

                    frame_count = getattr(
                        image,
                        "n_frames",
                        1,
                    )

                    image.verify()

        except (
                Image.DecompressionBombError,
                Image.DecompressionBombWarning,
                UnidentifiedImageError,
                OSError,
                ValueError,
        ):
            return False, _(
                "Thumbnail is not a valid image."
            )

        if (
                image_format
                not in ALLOWED_THUMBNAIL_FORMATS
        ):
            return False, _(
                "Thumbnail image format is not supported."
            )

        if (
                declared_format
                and image_format != declared_format
        ):
            return False, _(
                "Thumbnail image type does not match "
                "its data URL."
            )

        if frame_count != 1:
            return False, _(
                "Animated thumbnails are not supported."
            )

        if (
                width <= 0
                or height <= 0
                or width > MAX_THUMBNAIL_WIDTH
                or height > MAX_THUMBNAIL_HEIGHT
                or width * height > MAX_THUMBNAIL_PIXELS
        ):
            return False, _(
                "Thumbnail dimensions are too large."
            )

        return self._normalize_thumbnail_image(
            decoded
        )

    # -------------------------------------------------------------------------
    # RPC API used by OWL action
    # -------------------------------------------------------------------------

    @api.model
    def get_user_boards(
            self,
            offset=0,
            limit=None,
            current_board_id=None,
    ):
        """
        Return one page of active boards owned by the current user.

        The currently open board is returned separately when it falls
        outside the requested page. This keeps an older board visible in
        the selector without loading the full board collection.
        """
        normalized_offset = (
            self._normalize_board_page_integer(
                offset,
                default=0,
                minimum=0,
                maximum=MAX_BOARDS_PER_USER,
            )
        )

        normalized_limit = (
            self._normalize_board_page_integer(
                limit,
                default=DEFAULT_BOARD_PAGE_SIZE,
                minimum=1,
                maximum=MAX_BOARD_LIST_RESULTS,
            )
        )

        domain = [
            ("user_id", "=", self.env.uid),
            ("active", "=", True),
        ]

        # Fetch one additional record so has_more can be determined
        # without issuing a separate search_count query.
        fetched_boards = self.search(
            domain,
            order="write_date desc, id desc",
            offset=normalized_offset,
            limit=normalized_limit + 1,
        )

        has_more = (
                len(fetched_boards)
                > normalized_limit
        )

        page_boards = fetched_boards[
            :normalized_limit
        ]

        page_board_ids = set(
            page_boards.ids
        )

        current_board_item = False

        if current_board_id:
            current_board = (
                self._get_current_user_board(
                    current_board_id
                )
            )

            if (
                    current_board
                    and current_board.id
                    not in page_board_ids
            ):
                current_board_item = (
                    self._board_list_item(
                        current_board
                    )
                )

        return {
            "boards": [
                self._board_list_item(board)
                for board in page_boards
            ],
            "current_board": current_board_item,
            "offset": normalized_offset,
            "next_offset": (
                    normalized_offset
                    + len(page_boards)
            ),
            "has_more": has_more,
        }

    @api.model
    def create_board(self, name=None):
        """
        Create a new board for the current user.
        """
        name_ok, name_result = (
            self._validate_board_name(
                name,
                default=_("Untitled Board"),
            )
        )

        if not name_ok:
            return {
                "error": name_result,
            }

        board = self.create({
            "name": name_result,
        })

        return self._board_payload(board)

    @api.model
    def get_or_create_latest_board(self):
        """
        Used when opening the main Whiteboard menu.

        Multi-board behavior:
        - open latest board if user already has boards
        - otherwise create the first board
        """
        board = self.search(
            [
                ("user_id", "=", self.env.uid),
                ("active", "=", True),
            ],
            limit=1,
            order="write_date desc, id desc",
        )

        if not board:
            board = self.create({"name": _("My Whiteboard")})

        return self._board_payload(board)

    @api.model
    def get_my_board(self):
        """
        Backward-compatible alias.

        Old code expected one board per user.
        New behavior returns latest board or creates first board.
        """
        return self.get_or_create_latest_board()

    @api.model
    def get_board_data(self, board_id):
        """
        Return data for a specific board only if owned by current user.
        """
        board = self._get_current_user_board(board_id)

        if not board:
            return {"error": _("Board not found or access denied.")}

        return self._board_payload(board)

    @api.model
    def save_my_board(
            self,
            board_id,
            data_json,
            thumbnail_data_url=None,
            name=None,
            expected_revision=None,
    ):
        """
        Save a board owned by the current user using optimistic
        concurrency protection.

        The save is rejected when the client revision is older than the
        revision currently stored in the database.
        """
        board = self._get_current_user_board(board_id)

        if not board:
            return {
                "error": _(
                    "Board not found or access denied."
                ),
            }

        revision_ok, revision_result = (
            self._validate_expected_revision(
                expected_revision
            )
        )

        if not revision_ok:
            return {
                "error": revision_result,
            }

        name_ok, name_result = (
            self._validate_board_name(
                name,
                default=board.name,
            )
        )

        if not name_ok:
            return {
                "error": name_result,
            }

        json_ok, json_result = self._validate_data_json(
            data_json
        )

        if not json_ok:
            return {
                "error": json_result,
            }

        thumb_ok, thumb_result = (
            self._extract_thumbnail_base64(
                thumbnail_data_url
            )
        )

        if not thumb_ok:
            return {
                "error": thumb_result,
            }

        # ORM writes can be delayed until a flush. Make sure the
        # concurrency fields are current in PostgreSQL before locking
        # and reading the row.
        board.flush_recordset([
            "revision",
            "active",
            "user_id",
        ])

        # Lock the database row so two concurrent saves cannot both
        # validate the same revision and then overwrite one another.
        self.env.cr.execute(
            """
                SELECT revision, active, user_id
                  FROM whiteboard_board
                 WHERE id = %s
                 FOR UPDATE
            """,
            [board.id],
        )
        row = self.env.cr.fetchone()

        if not row:
            return {
                "error": _(
                    "Board not found or access denied."
                ),
            }

        current_revision, is_active, owner_id = row
        current_revision = current_revision or 0

        # Recheck security-sensitive values after acquiring the lock.
        if (
                not is_active
                or owner_id != self.env.uid
        ):
            return {
                "error": _(
                    "Board not found or access denied."
                ),
            }

        if revision_result != current_revision:
            return {
                "error": _(
                    "This whiteboard was changed in another tab or "
                    "session. Reload it before saving to avoid "
                    "overwriting newer changes."
                ),
                "conflict": True,
                "current_revision": current_revision,
            }

        vals = {
            "name": name_result,
            "data_json": json_result,
            "revision": current_revision + 1,
        }

        if thumb_result:
            vals["thumbnail"] = thumb_result

        # Use the validated internal write method so revision is increased
        # exactly once.
        board._write_validated_vals(vals)

        return {
            "ok": True,
            "board": self._board_payload(board),
        }

    def action_open_whiteboard(self):
        """
        Open this board in the whiteboard client action.
        """
        self.ensure_one()
        self.check_access_rights("read")
        self.check_access_rule("read")

        return {
            "type": "ir.actions.client",
            "tag": "odoo_whiteboard.whiteboard_action",
            "name": _("Whiteboard"),
            "params": {"board_id": self.id},
            "target": "current",
        }

