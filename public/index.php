<?php
declare(strict_types=1);

// PHP раздаёт интерфейс и не принимает документы или подписи.
if (!in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) {
    header('Allow: GET, HEAD');
    http_response_code(405);
    exit('Загрузка файлов на сервер отключена.');
}
header('Content-Type: text/html; charset=UTF-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
header("Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'");
header('Cache-Control: no-store');
?>
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Разместите свою подпись в PDF и Word. Документы обрабатываются в вашем браузере и не загружаются на сервер.">
  <title>Sign No Scan — подпись на документах</title>
  <link rel="stylesheet" href="assets/app.css">
  <script defer src="assets/vendor/lucide.min.js"></script>
  <script defer src="assets/vendor/jszip.min.js"></script>
  <script defer src="assets/vendor/pdf-lib.min.js"></script>
  <script type="module" src="assets/js/app.js"></script>
</head>
<body>
  <header class="header">
    <a class="brand" href="./"><span class="brand-icon"><i data-lucide="pen-line"></i></span><span>Sign No Scan<small>Документы остаются у вас</small></span></a>
    <span class="privacy-badge"><i data-lucide="shield-check"></i> Без загрузки на сервер</span>
    <button id="reset" class="icon-button" title="Очистить текущую работу" aria-label="Очистить текущую работу"><i data-lucide="trash-2"></i></button>
  </header>
  <main class="layout">
    <aside class="sidebar">
      <section class="panel">
        <div class="section-heading"><h2><span class="step">1</span> Документы</h2><span id="document-count" class="muted">0 / 8</span></div>
        <label class="drop-zone" id="drop-zone" tabindex="0" role="button">
          <i data-lucide="file-plus-2"></i><strong>Добавить документы</strong><span>PDF и Word · до 30 МБ каждый</span>
          <input id="documents-input" type="file" accept=".pdf,.docx" multiple hidden>
        </label>
        <div id="document-list" class="document-list" aria-label="Список документов"></div>
      </section>
      <section class="panel">
        <div class="section-heading"><h2><span class="step">2</span> Ваша подпись</h2></div>
        <button class="button full" id="upload-signature"><i data-lucide="image-up"></i> Из фотографии</button>
        <input id="signature-input" type="file" accept="image/png,image/jpeg,image/webp" hidden>
        <button class="button secondary full" id="draw-signature"><i data-lucide="pencil"></i> Нарисовать подпись</button>
        <div id="signature-list" class="signature-list"></div>
        <label class="toggle"><input id="remember-signatures" type="checkbox"><span>Запомнить подписи на этом устройстве</span></label>
        <p class="help">По умолчанию подписи исчезают после закрытия страницы. Документы никогда не сохраняются в браузере.</p>
        <button id="forget-signatures" class="text-button">Удалить сохранённые подписи</button>
      </section>
      <section class="panel placement-panel">
        <div class="section-heading"><h2><span class="step">3</span> Размещение</h2></div>
        <p class="help">Выберите подпись, нажмите «Поставить» и укажите место на странице. Затем перетащите её или потяните угол.</p>
        <button id="place-signature" class="button accent full" disabled><i data-lucide="stamp"></i> Поставить подпись</button>
        <div class="field-row"><label>Ширина, мм<input id="signature-width" type="number" min="5" max="180" value="35" step="1"></label><label>Поворот, °<input id="signature-angle" type="number" min="-180" max="180" value="0" step="1"></label></div>
        <div class="button-row"><button id="duplicate-placement" class="button secondary" disabled title="Копировать выбранную подпись"><i data-lucide="copy"></i> Копия</button><button id="remove-placement" class="button secondary" disabled><i data-lucide="x"></i> Убрать</button></div>
        <div class="button-row"><button id="undo" class="button secondary" disabled><i data-lucide="undo-2"></i> Назад</button><button id="redo" class="button secondary" disabled><i data-lucide="redo-2"></i> Вперёд</button></div>
      </section>
    </aside>
    <section class="workspace">
      <div class="toolbar"><div class="document-title"><strong id="active-name">Добавьте первый документ</strong><span id="active-details">Работа в браузере · PDF / DOCX</span></div><div class="toolbar-actions"><label class="format-label">Сохранить как<select id="export-format"><option value="original">Исходный формат</option><option value="png">Картинки (PNG)</option><option value="jpg">Картинки (JPG)</option><option value="pdf">PDF</option><option value="docx">Word (DOCX)</option></select></label><button id="download-current" class="button accent" disabled><i data-lucide="download"></i><span>Скачать</span></button><button id="download-all" class="button secondary" disabled title="Скачать все подписанные документы архивом"><i data-lucide="archive"></i><span>Все файлы</span></button></div></div>
      <div id="word-notice" class="notice" hidden>Предпросмотр Word приблизительный: шрифты и переносы могут отличаться. При сохранении в DOCX сохраняется исходный текст и добавляются подписи. Для точного совпадения страниц используйте PDF.</div>
      <div id="export-notice" class="notice" hidden></div>
      <div class="page-controls"><button id="previous-page" class="icon-button" aria-label="Предыдущая страница" disabled><i data-lucide="chevron-left"></i></button><label>Страница <input id="page-number" type="number" min="1" value="1" disabled> <span id="page-total">/ 0</span></label><button id="next-page" class="icon-button" aria-label="Следующая страница" disabled><i data-lucide="chevron-right"></i></button><div class="zoom"><button id="zoom-out" class="icon-button" aria-label="Уменьшить масштаб"><i data-lucide="minus"></i></button><button id="zoom-fit" class="text-button">100%</button><button id="zoom-in" class="icon-button" aria-label="Увеличить масштаб"><i data-lucide="plus"></i></button></div><span id="placement-count" class="muted">Подписей: 0</span></div>
      <div id="viewer" class="viewer">
        <div id="empty-state" class="empty-state"><div class="empty-icon"><i data-lucide="file-signature"></i></div><h1>Ваша подпись на документе</h1><p>Загрузите PDF или Word, добавьте подпись<br>и скачайте PNG, JPG, PDF или DOCX.</p><span class="private-note"><i data-lucide="lock-keyhole"></i> Файлы не покидают ваше устройство</span></div>
        <div id="paper" class="paper" hidden><canvas id="pdf-canvas"></canvas><iframe id="docx-frame" title="Предпросмотр Word" sandbox="allow-scripts" src="docx-frame.html" hidden></iframe><div id="overlay" class="overlay" aria-label="Размещение подписей"></div></div>
      </div>
      <footer class="workspace-footer"><span id="status" role="status" aria-live="polite">Готово к работе</span><span class="muted">v1.1.0</span></footer>
    </section>
  </main>
  <dialog id="signature-dialog" class="signature-dialog">
    <div class="dialog-heading"><h2 id="signature-dialog-title">Подготовить подпись</h2><button id="close-dialog" class="icon-button" aria-label="Закрыть"><i data-lucide="x"></i></button></div>
    <div id="photo-tools"><p class="help">Выделите подпись прямоугольником, если на фото есть другие надписи. Фон удаляется автоматически, цвет чернил сохраняется.</p><div class="photo-area"><canvas id="photo-canvas"></canvas><div id="crop-box" hidden></div></div><div class="field-row"><label class="grow">Удаление фона <input id="background-threshold" type="range" min="60" max="240" value="150"></label><button id="reset-crop" class="button secondary">Всё фото</button><button id="rotate-photo" class="button secondary" title="Повернуть фото на 90 градусов"><i data-lucide="rotate-cw"></i></button></div></div>
    <div id="draw-tools" hidden><p class="help">Нарисуйте подпись мышью, пальцем или стилусом.</p><canvas id="draw-canvas" width="1000" height="360"></canvas><div class="field-row"><label>Цвет<input id="ink-color" type="color" value="#173aac"></label><label class="grow">Толщина<input id="ink-width" type="range" min="1" max="8" value="3"></label><button id="clear-drawing" class="button secondary">Очистить</button></div></div>
    <div class="signature-result"><span class="muted">Подпись без фона</span><div class="checkerboard"><img id="signature-preview" alt="Подготовленная подпись" hidden></div></div>
    <p id="signature-error" class="error-text" role="alert"></p>
    <div class="dialog-actions"><button id="cancel-signature" class="button secondary">Отмена</button><button id="save-signature" class="button accent"><i data-lucide="check"></i> Использовать подпись</button></div>
  </dialog>
  <dialog id="confirm-dialog" class="confirm-dialog"><h2>Очистить текущую работу?</h2><p>Документы и размещённые подписи будут убраны. Сохранённые на устройстве подписи останутся.</p><div class="dialog-actions"><button id="cancel-reset" class="button secondary">Отмена</button><button id="confirm-reset" class="button danger">Очистить</button></div></dialog>
  <noscript>Для обработки документов в браузере включите JavaScript.</noscript>
</body>
</html>
