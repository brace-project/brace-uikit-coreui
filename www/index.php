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
use Brace\Router\Type\Route;
use Brace\UiKit\CoreUi\CoreUiConfig;
use Brace\UiKit\CoreUi\CoreUiModule;
use Brace\UiKit\CoreUi\Element\Button;
use Brace\UiKit\CoreUi\Element\Spacer;
use Brace\UiKit\CoreUi\Element\Title;
use Brace\UiKit\CoreUi\Template\CoreUiPageReturnFormatter;
use Brace\UiKit\CoreUi\Template\Page;


require __DIR__ . "/../vendor/autoload.php";

AppLoader::loadApp()->run();
