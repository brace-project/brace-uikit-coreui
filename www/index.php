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
use Brace\UiKit\CoreUi\Button;
use Brace\UiKit\CoreUi\CoreUiConfig;
use Brace\UiKit\CoreUi\CoreUiModule;
use Brace\UiKit\CoreUi\CoreUiPageReturnFormatter;
use Brace\UiKit\CoreUi\CoreUiRenderer;
use Brace\UiKit\CoreUi\Page;
use Brace\UiKit\CoreUi\Spacer;
use Brace\UiKit\CoreUi\Title;
use Laminas\Diactoros\Response\JsonResponse;

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


$app->router->onGet("/", function (Route $route, CoreUiRenderer $coreUiRenderer, CoreUiConfig $coreUiConfig) {


    return new Page("wurst");
});

$app->run();
