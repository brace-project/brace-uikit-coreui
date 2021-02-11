<?php


namespace Brace\UiKit\CoreUi;


use Brace\Core\BraceApp;
use Brace\Core\BraceModule;
use Phore\Di\Container\Producer\DiValue;

class CoreUiModule implements BraceModule
{

    private $assetRoot;

    public function __construct (string $assetRoot = "/assets/")
    {
        $this->assetRoot = $assetRoot;
    }


    public function register(BraceApp $app)
    {
        $app->assets->virtual($this->assetRoot . "ui-bundle.css", "text/css")
            ->addFile(__DIR__ . "/../lib-dist/coreui.min.css")
            ->addFile(__DIR__ . "/../lib-dist/coreui-user-styles.css")
            ->addFile(__DIR__ . "/../lib-dist/coreui-icons-master/css/all.css");
        $app->assets->virtual($this->assetRoot . "ui-bundle.js", "text/javascript")
            ->addFile(__DIR__ . "/../lib-dist/coreui.min.js")
            ->addFile(__DIR__ . "/../lib-dist/pace.min.js")
            ->addFile(__DIR__ . "/../lib-dist/perfect-scrollbar.min.js");
        $app->define("coreUiRenderer", new DiValue(new CoreUiRenderer($app)));
        $app->define("coreUiConfig", new DiValue(new CoreUiConfig()));
    }
}