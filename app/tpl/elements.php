
    <div class="row flex-xl-nowrap">
        <div class="col-12 col-md-12 col-lg-10 markdown-body">
            <?php

            $files = glob(__DIR__ . "/all/*.html");
            foreach ($files as $file)
                echo file_get_contents($file);

            ?>
        </div>
        <div class="col-md-0 col-lg-2">
            <p></p>
            <div class="list-group shadow-sm sticky-top" id="scroll-spy1" style="top:8em"></div>
        </div>
    </div>

<script
    src="https://code.jquery.com/jquery-3.5.1.slim.min.js"
    integrity="sha256-4+XzXVhsDmqanXGHaHvgh1gMQKX40OUvDEBTu8JcmNs="
    crossorigin="anonymous"></script>
<script language="javascript">
    $("h2").each(function (elem) {
        var title = $(this).attr("title");
        if (typeof title ==  "undefined")
            title = $("small", this).text();
        if (title == "")
            title = $(this).text();

        var key = $(this).attr("id");


        $("#scroll-spy1").append('<a class="list-group-item list-group-item-action" href="#' + key + '">' + title + "</a>");
    })

    window.addEventListener("load", () => {
        new coreui.Scrollspy(document.body, {
            target: "#scroll-spy1"
        });
    });


</script>