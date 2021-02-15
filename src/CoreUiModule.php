<?php


namespace Brace\UiKit\CoreUi;


use Brace\Core\BraceApp;
use Brace\Core\BraceModule;
use Phore\Di\Container\Producer\DiService;
use Phore\Di\Container\Producer\DiValue;

class CoreUiModule implements BraceModule
{

    private $assetRoot;

    private $factory;


    public function __construct (string $assetRoot = "/assets/")
    {
        $this->assetRoot = $assetRoot;
    }


    public function register(BraceApp $app)
    {
        $app->assets->virtual($this->assetRoot . "css/ui-bundle.css", "text/css")
            ->addFile(__DIR__ . "/../lib-dist/coreui.min.css")
            ->addFile(__DIR__ . "/../lib-dist/coreui-user-styles.css")
            ->addFile(__DIR__ . "/../lib-dist/bootstrap-icons-1.3.0/bootstrap-icons.css")
            ->addFile(__DIR__ . "/../lib-dist/coreui-icons-master/css/free.min.css");

        $app->assets->virtual($this->assetRoot . "js/ui-bundle.js", "text/javascript")
            ->addFile(__DIR__ . "/../lib-dist/coreui.min.js")
            ->addFile(__DIR__ . "/../lib-dist/coreui-utils.min.js")
            ->addFile(__DIR__ . "/../lib-dist/pace.min.js")
            ->addFile(__DIR__ . "/../lib-dist/perfect-scrollbar.min.js");

        $app->assets->virtual($this->assetRoot . "js/plugins.js", "text/javascript")
            ->addFile(__DIR__ . "/../lib-dist/codemirror/codemirror.min.js")
            ->addFile(__DIR__ . "/../lib-dist/codemirror/codemirror-html.js")
            ->addFile(__DIR__ . "/../lib-dist/chartjs/chartjs.min.js");

        $app->assets->virtual($this->assetRoot . "css/plugins.css", "text/css")
            ->addFile(__DIR__ . "/../lib-dist/codemirror/codemirror.css")
            ->addFile(__DIR__ . "/../lib-dist/chartjs/chartjs.min.css");

        // Icons
        $app->assets->virtual($this->assetRoot . "fonts/CoreUI-Icons-Free.woff")
            ->addFile(__DIR__ . "/../lib-dist/coreui-icons-master/fonts/CoreUI-Icons-Free.woff");
        $app->assets->virtual($this->assetRoot . "fonts/CoreUI-Icons-Free.woff2")
            ->addFile(__DIR__ . "/../lib-dist/coreui-icons-master/fonts/CoreUI-Icons-Free.woff2");
        $app->assets->virtual($this->assetRoot . "fonts/CoreUI-Icons-Free.ttf")
            ->addFile(__DIR__ . "/../lib-dist/coreui-icons-master/fonts/CoreUI-Icons-Free.ttf");

        $app->assets->virtual($this->assetRoot . "css/fonts/bootstrap-icons.woff")
            ->addFile(__DIR__ . "/../lib-dist/bootstrap-icons-1.3.0/fonts/bootstrap-icons.woff");
        $app->assets->virtual($this->assetRoot . "css/fonts/bootstrap-icons.woff2")

            ->addFile(__DIR__ . "/../lib-dist/bootstrap-icons-1.3.0/fonts/bootstrap-icons.woff2");

        $app->define("coreUiConfig", new DiValue(new CoreUiConfig($this->assetRoot)));
        $app->define("coreUiConfigPreset", new DiValue(new CoreUiConfig($this->assetRoot)));

    }
}