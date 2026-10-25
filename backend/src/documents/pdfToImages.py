import sys
import io
import json
import pypdfium2 as pdfium

def convert_pdf_to_images(pdf_bytes, max_pages=10, scale=2.0):
    """
    Safely converts a PDF byte buffer into a list of PNG byte buffers.
    Enforces maximum page limits to protect CPU/memory resources.
    """
    try:
        doc = pdfium.PdfDocument(pdf_bytes)
        num_pages = len(doc)
        pages_to_process = min(num_pages, max_pages)

        images = []
        for i in range(pages_to_process):
            page = doc[i]
            # scale=2.0 gives ~150-200 DPI suitable for OCR
            pil_image = page.render(scale=scale).to_pil()
            img_byte_arr = io.BytesIO()
            pil_image.save(img_byte_arr, format='PNG')
            images.append({
                'page': i + 1,
                'width': pil_image.width,
                'height': pil_image.height,
                'png_base64': img_byte_arr.getvalue().hex()
            })

        return {
            'success': True,
            'totalPages': num_pages,
            'processedPages': len(images),
            'pages': images
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

if __name__ == '__main__':
    # Read PDF from stdin (binary or hex)
    raw_input = sys.stdin.read().strip()
    if not raw_input:
        print(json.dumps({'success': False, 'error': 'No input provided'}))
        sys.exit(0)

    try:
        pdf_data = bytes.fromhex(raw_input)
        res = convert_pdf_to_images(pdf_data)
        print(json.dumps(res))
    except Exception as err:
        print(json.dumps({'success': False, 'error': f'Failed to parse hex input: {str(err)}'}))
