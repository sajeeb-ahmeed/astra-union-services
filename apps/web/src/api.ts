export class ApiError extends Error {
  constructor(
    message: string,
    public details: any,
    public status: number,
  ) {
    super(message);
  }
}
let csrfToken = "";
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: "include",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(csrfToken && method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response
    .json()
    .catch(() => ({ message: "Server response could not be read." }));
  if (!response.ok)
    throw new ApiError(
      data.error?.message ||
        data.error ||
        data.message ||
        `Request failed (${response.status})`,
      data,
      response.status,
    );
  if (data.csrfToken) csrfToken = data.csrfToken;
  return data;
}
export const items = (value: any): any[] =>
  Array.isArray(value)
    ? value
    : value?.items ||
      value?.applications ||
      value?.citizens ||
      value?.services ||
      value?.tenants ||
      [];
