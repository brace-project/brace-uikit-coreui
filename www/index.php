<?php
namespace App;


use Brace\Assets\AssetsMiddleware;
use Brace\Assets\AssetsModule;
use Brace\Core\Base\JsonReturnFormatter;
use Brace\Core\Base\NotFoundMiddleware;
use Brace\Core\BraceApp;
use Brace\Mod\Request\Zend\BraceRequestZendModule;
use Brace\Router\RouterDispatchMiddleware;
use Brace\Router\RouterEvalMiddleware;
use Brace\Router\RouterModule;
use Brace\Router\Type\Route;
use Brace\UiKit\CoreUi\CoreUiConfig;
use Brace\UiKit\CoreUi\CoreUiModule;
use Brace\UiKit\CoreUi\Element\Button;
use Brace\UiKit\CoreUi\Element\Spacer;
use Brace\UiKit\CoreUi\Element\Title;
use Brace\UiKit\CoreUi\Template\CoreUiPageReturnFormatter;
use Brace\UiKit\CoreUi\Template\Page;


require __DIR__ . "/../vendor/autoload.php";

$app = new BraceApp();

$app->addModule(new BraceRequestZendModule());
$app->addModule(new RouterModule());
$app->addModule(new AssetsModule());
$app->addModule(new CoreUiModule(function() {
    $coreUiConfig = new CoreUiConfig();
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

$app->setPipe([
    new AssetsMiddleware(["/assets/"]),
    new RouterEvalMiddleware(),
    new RouterDispatchMiddleware([
        new CoreUiPageReturnFormatter($app),
        new JsonReturnFormatter($app)
    ]),
    new NotFoundMiddleware()
]);


$app->router->onGet("/", function (Route $route) {
    return Page::createCoreUiPage()
        ->loadMarkdown("tpl/welcome.md");
});

$app->router->onGet("/elements", function () {
    return Page::createCoreUiPage()
        ->loadMarkdown("tpl/welcome.md");
});

$app->run();
