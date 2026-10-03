export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RANGE_NOT_SATISFIABLE: 416,
  INTERNAL: 500,
};

export function ok(body) {
  return { ok: true, ...body };
}

export function fail(code, reason) {
  return { ok: false, error: code, reason };
}
