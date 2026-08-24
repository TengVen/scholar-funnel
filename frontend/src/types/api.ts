/**
 * API 基础设施类型 —— 纯类型，禁止业务实现
 */

/** HTTP 层统一错误（替代裸 Error，携带状态码与后端 detail） */
export class ApiError extends Error {
  /** HTTP 状态码（0 = 网络层错误/未知） */
  status: number;
  /** 后端返回的原始 detail（未解析，可能是字符串或对象） */
  detail: unknown;

  constructor(message: string, status = 0, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

/**
 * 统一响应包装（预留）。
 * 说明：后端当前未使用统一响应包装（各接口直接返回 DTO），
 * 待后端收敛后，request<T> 可在此处解包 data 字段，前端无需改动。
 */
export interface ApiEnvelope<T> {
  data: T;
}
