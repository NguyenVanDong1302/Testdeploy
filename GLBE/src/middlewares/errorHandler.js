const { AppError } = require("../utils/errors");

function errorHandler(err, req, res, next) {
  if (err?.name === "MulterError") {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "Uploaded file is too large"
        : err.message || "Upload failed";
    return res.status(status).json({
      ok: false,
      code: err.code || "UPLOAD_ERROR",
      message,
    });
  }

  const isAppError = err instanceof AppError;
  const status = isAppError ? err.statusCode : 500;
  const code = isAppError ? err.code : "INTERNAL_SERVER_ERROR";
  const message = isAppError
    ? err.message
    : err?.message || "Something went wrong";

  console.error("🔥 ERROR:", err); // <-- cái này giúp thấy lỗi thật trong terminal

  res.status(status).json({
    ok: false,
    code,
    message,
    ...(err?.details ? { data: err.details } : {}),
  });
}

module.exports = { errorHandler };
