export function errorHandler(err, _req, res, _next) {
    console.error('[api] error', err);
    if (err instanceof Error && 'status' in err) {
        const status = Number(err.status) || 500;
        res.status(status).json({ error: err.message });
        return;
    }
    const message = err instanceof Error ? err.message : 'Internal server error';
    // Don't leak stack in production; do log it above
    res.status(500).json({ error: message });
}
//# sourceMappingURL=errorHandler.js.map