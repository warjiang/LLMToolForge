import { toPng, toSvg } from 'html-to-image';
import { ExportOptions } from '../types/json-diagram';

/**
 * 导出 React Flow 图表为图片
 */
export async function exportDiagramAsImage(
  elementRef: HTMLDivElement | null,
  options: ExportOptions = { format: 'png' }
): Promise<void> {
  if (!elementRef) {
    console.error('Element reference is null');
    return;
  }

  try {
    const { format, quality = 1, width, height, backgroundColor = '#ffffff' } =
      options;

    let dataUrl: string;

    if (format === 'png') {
      dataUrl = await toPng(elementRef, {
        width: width,
        height: height,
        quality,
        pixelRatio: 2,
        backgroundColor,
      });
    } else {
      // SVG 导出
      dataUrl = await toSvg(elementRef, {
        width,
        height,
        backgroundColor,
      });
    }

    // 创建下载链接
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `json-diagram.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (error) {
    console.error('Failed to export diagram:', error);
    throw new Error(`Failed to export diagram as ${options.format}`);
  }
}

/**
 * 获取 React Flow 容器的尺寸
 */
export function getDiagramDimensions(
  elementRef: HTMLDivElement | null
): { width: number; height: number } | null {
  if (!elementRef) return null;

  return {
    width: elementRef.offsetWidth,
    height: elementRef.offsetHeight,
  };
}

/**
 * 生成图表的唯一文件名
 */
export function generateExportFileName(format: 'png' | 'svg'): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `json-diagram-${timestamp}.${format}`;
}
