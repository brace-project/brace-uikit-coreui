<?php
namespace App;

use Brace\Assets\AssetsMiddleware;
use Brace\Assets\AssetsModule;
use Brace\Core\AppLoader;
use Brace\Core\Base\JsonReturnFormatter;
use Brace\Core\Base\NotFoundMiddleware;
use Brace\Core\BraceApp;
use Brace\Mod\Request\Zend\BraceRequestLaminasModule;
use Brace\Router\RouterDispatchMiddleware;
use Brace\Router\RouterEvalMiddleware;
use Brace\Router\RouterModule;
use Brace\UiKit\Base\Template\UiKitPageReturnFormatter;
use Brace\UiKit\CoreUi\CoreUiModule;

AppLoader::extend(function (BraceApp $app) {
    $app->addModule(new BraceRequestLaminasModule());
    $app->addModule(new RouterModule());
    $app->addModule(new AssetsModule());
    $app->addModule(new CoreUiModule());
    $app->setPipe([
        new AssetsMiddleware(["/assets/"]),
        new RouterEvalMiddleware(),
        new RouterDispatchMiddleware([
            new UiKitPageReturnFormatter($app),
            new JsonReturnFormatter($app)
        ]),
        new NotFoundMiddleware()
    ]);
});