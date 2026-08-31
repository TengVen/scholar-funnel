/** webpack `?url` 资源导入（如 pdfjs-dist worker 静态 URL） */
declare module "*?url" {
  const url: string;
  export default url;
}
