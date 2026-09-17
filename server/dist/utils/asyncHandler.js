export function asyncHandler(fn) {
    return (req, res, next) => { void fn(req, res, next).catch(next); };
}
//# sourceMappingURL=asyncHandler.js.map