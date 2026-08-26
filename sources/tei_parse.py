"""
tei_parse.py — 解析 OpenAlex 分发的 GROBID TEI XML

OpenAlex 对 OA 论文用 GROBID 转成 TEI（事实标准学术 PDF 解析），
结构里天然带：
  - teiHeader / profileDesc/abstract : 干净的摘要
  - body 下嵌套的 <div><head> 章节层级 : 无需启发式、无页眉页脚噪声
  - 参考文献（带 DOI）、图、表、公式坐标

parse_tei(xml_text) -> (abstract:str, sections:list[dict])
  sections 每项: {level, title, text}   （text 为该节完整正文）

注意：OpenAlex 返回的 XML 是 gzip 压缩（content-type=application/gzip），
解压在 sources/openalex.py::fetch_grobid_xml 中完成，本模块只吃解压后的文本。

依赖：标准库 xml.etree.ElementTree
"""
import xml.etree.ElementTree as ET

# TEI 命名空间
TEI = "{http://www.tei-c.org/ns/1.0}"


def parse_tei(xml_text: str):
    """
    解析 GROBID TEI XML，返回 (abstract, sections)。

    Returns:
        abstract: str  （空串表示 XML 中无摘要）
        sections: list[dict]，每项 {level:int, title:str, text:str}
    """
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        raise ValueError(f"TEI XML 解析失败: {e}")

    # 摘要
    abstract = ""
    abd = root.find(f".//{TEI}profileDesc/{TEI}abstract")
    if abd is not None:
        abstract = " ".join(abd.itertext()).strip()

    # 分节（递归 div/head）
    sections: list[dict] = []
    body = root.find(f".//{TEI}body")

    def walk(div, level: int):
        head = div.find(f"{TEI}head")
        title = "".join(head.itertext()).strip() if head is not None else ""
        paras = []
        for ch in div:
            if ch.tag == f"{TEI}div":
                continue
            if ch.tag in (f"{TEI}p", f"{TEI}ab", f"{TEI}trailer"):
                txt = " ".join(ch.itertext()).strip()
                if txt:
                    paras.append(txt)
        if title:
            sections.append({"level": level, "title": title, "text": "\n".join(paras)})
        for ch in div:
            if ch.tag == f"{TEI}div":
                walk(ch, level + 1)

    if body is not None:
        for d in body:
            if d.tag == f"{TEI}div":
                walk(d, 1)

    return abstract, sections
