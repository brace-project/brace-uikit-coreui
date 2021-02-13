<?php
namespace App;

use Brace\Core\AppLoader;
use Brace\Core\BraceApp;
use Brace\UiKit\CoreUi\CoreUiConfig;
use Brace\UiKit\CoreUi\Element\Button;
use Brace\UiKit\CoreUi\Element\Spacer;
use Brace\UiKit\CoreUi\Element\Title;
use Phore\Di\Container\Producer\DiService;

AppLoader::extend(function (BraceApp $app) {
    $app->define("coreUiConfig", new DiService(function (CoreUiConfig $coreUiConfigPreset) {
        $coreUiConfig = clone $coreUiConfigPreset;
        $coreUiConfig->sideNav
            ->addElement(new Button("ClickMe", "cil-speedometer", "#test"))
            ->addElement(new Button("Button", "cil-puzzle", "", [
                new Button("Subnavi"),
                (new Button("Subnavi2"))->setBadge("hello")
            ]));

        $coreUiConfig->topNav
            ->addElement(new Button("Dashboard", "", "/"));


        $coreUiConfig->topRightNav
            ->addElement(new Button("", "cil-fingerprint", "/"));

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