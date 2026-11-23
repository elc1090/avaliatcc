(() => {
  'use strict';

  const assets = new URL('./pdfjs/', document.currentScript.src);
  const active = new WeakMap();
  let library;

  function clear(container) {
    const preview = active.get(container);
    active.delete(container);
    preview?.render?.cancel();
    if (preview?.loading) preview.loading.destroy().catch(console.warn);
    container.replaceChildren();
  }

  async function show(container, blob) {
    clear(container);
    const preview = {};
    active.set(container, preview);
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = 'Carregando prévia do PDF…';
    container.append(status);

    try {
      library ??= import(new URL('pdf.min.mjs', assets)).catch(error => {
        library = undefined;
        throw error;
      });
      const pdfjs = await library;
      const data = await blob.arrayBuffer();
      if (active.get(container) !== preview) return;

      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', assets).href;
      preview.loading = pdfjs.getDocument({
        data,
        standardFontDataUrl: new URL('standard_fonts/', assets).href,
        useWasm: false,
        isEvalSupported: false
      });
      const pdf = await preview.loading.promise;
      const pages = document.createDocumentFragment();

      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        if (active.get(container) !== preview) return;

        const original = page.getViewport({scale: 1});
        const viewport = page.getViewport({scale: 1400 / original.width});
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `Página ${number} de ${pdf.numPages} do PDF`);
        preview.render = page.render({canvas, viewport});
        await preview.render.promise;
        pages.append(canvas);
      }

      if (active.get(container) === preview) container.replaceChildren(pages);
    } catch (error) {
      if (active.get(container) !== preview) return;
      console.warn('Falha ao exibir a prévia do PDF.', error);
      status.textContent = 'Não foi possível exibir a prévia. Use “Baixar PDF” para conferir o documento.';
    } finally {
      if (active.get(container) === preview) {
        active.delete(container);
        if (preview.loading) await preview.loading.destroy().catch(console.warn);
      }
    }
  }

  window.AvaliaPdfPreview = {show, clear};
})();
