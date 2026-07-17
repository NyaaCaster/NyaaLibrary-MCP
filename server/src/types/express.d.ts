// 扩展 Express Request 类型，添加 memory 中间件附着的 ownerKey 属性。
declare namespace Express {
  interface Request {
    ownerKey?: string;
  }
}
