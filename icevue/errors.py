"""Domain errors translated into API responses."""


class CatalogConfigurationError(RuntimeError):
    """The catalog configuration is incomplete or invalid."""


class CatalogConnectionError(RuntimeError):
    """The configured catalog could not be reached."""


class TableNotFoundError(RuntimeError):
    """The requested table does not exist."""


class NamespaceNotFoundError(RuntimeError):
    """The requested namespace does not exist."""


class WriteNotSupportedError(RuntimeError):
    """The catalog does not support write operations."""

