<?php
namespace App;

use Brace\Assets\AssetsMiddleware;
use Brace\Assets\AssetsModule;
use Brace\Core\AppLoader;
use Brace\Core\Base\JsonReturnFormatter;
use Brace\Core\Base\NotFoundMiddleware;
use Brace\Core\BraceApp;
use Brace\Mod\Request\Zend\BraceRequestZendModule;
use Brace\Router\RouterDispatchMiddleware;
use Brace\Router\RouterEvalMiddleware;
use Brace\Router\RouterModule;
use Brace\UiKit\CoreUi\CoreUiConfig;
use Brace\UiKit\CoreUi\CoreUiModule;
use Brace\UiKit\CoreUi\Template\CoreUiPageReturnFormatter;

AppLoader::extend(function (BraceApp $app) {
    $app->addModule(new BraceRequestZendModule());
    $app->addModule(new RouterModule());
    $app->addModule(new AssetsModule());
    $app->addModule(new CoreUiModule());
    $app->setPipe([
        new AssetsMiddleware(["/assets/"]),
        new RouterEvalMiddleware(),
        new RouterDispatchMiddleware([
            new CoreUiPageReturnFormatter($app),
            new JsonReturnFormatter($app)
        ]),
        new NotFoundMiddleware()
    ]);
});