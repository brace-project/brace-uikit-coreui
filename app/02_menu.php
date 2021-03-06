<?php
namespace App;

use Brace\Core\AppLoader;
use Brace\Core\BraceApp;
use Brace\UiKit\Base\Element\Button;
use Brace\UiKit\Base\Element\Spacer;
use Brace\UiKit\Base\Element\Title;
use Brace\UiKit\CoreUi\CoreUiConfig;
use Phore\Di\Container\Producer\DiService;

AppLoader::extend(function (BraceApp $app) {
    $app->define("coreUiConfig", new DiService(function (CoreUiConfig $coreUiConfigPreset) {
        $coreUiConfig = clone $coreUiConfigPreset;
        $coreUiConfig->sideNav
            ->addElement(new Button("Home", "cil-speedometer", "/"))
            ->addElement(new Button("Basic Elements", "cil-puzzle", "/elements"))
            ->addElement(new Button("Icons", "cil-4k", "/icons"))
            ->addElement(new Button("Plugins", "cil-puzzle", "", [

                new Button("Charts", "cil-chart", "/charts"),
                new Button("Table", "cil-table", "/table"),
                (new Button("Editor", "cil-editor", "/editor"))->setBadge("Markdown")
            ]));

        $coreUiConfig->topNav
            ->addElement(new Button("Dashboard", "", "/"));


        $coreUiConfig->topRightNav
            ->addElement(new Button("", "bi-github", "https://github.com/brace-project/brace-uikit-coreui"));

        $coreUiConfig->breadcrumb
            ->addElement(new Button("Home"))
            ->addElement(new Button("Dash", "", "/"));

        $coreUiConfig->accountPopup
            ->addElement(new Title("Account"))
            ->addElement(new Button("Messages"))
            ->addElement(new Spacer())
            ->addElement(new Button("Logout", "cil-account-logout"));
        return $coreUiConfig;
    }));
});