<div class="card">
    <div class="card-header">
        CodeMirror Editor
        <div class="card-header-actions">
            <a href="https://codemirror.net" class="card-header-action" target="_blank"><small
                        class="text-muted">docs</small></a>
        </div>
    </div>

    <textarea id="codemirror1" style="display: none;">
        <html>
        </html>
    </textarea>


</div>
<script>
    window.addEventListener("load", () => {
        var editor = CodeMirror.fromTextArea(document.getElementById("codemirror1"), {
            mode: 'html',
            lineNumbers: true,
            theme: 'default'
        });
        editor.setSize('100%', 700);
    })


</script>