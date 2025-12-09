//  THIS IS INTENDED FOR USE IN GOOGLE EARTH ENGINE (GEE)

// load study area
var ecoregions = ee.FeatureCollection("RESOLVE/ECOREGIONS/2017");
var aoi = ecoregions.filter(ee.Filter.eq('ECO_NAME', 'Edwards Plateau savanna'));

// ---------- LANDSAT ---------------------
var startDate = '2023-01-01';
var endDate = '2023-12-31';

// load landsat 8 for 2022
var l8All_2023 = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
.filterBounds(aoi)
.filterDate(startDate, endDate);

// define and apply cloud mask
function applyCloudMask(image) {
  var QA_PIXEL = image.select('QA_PIXEL');
  
  // Cloud and shadow bits
  var cloudBit = 1 << 3;  // bit 3: cloud
  var shadowBit = 1 << 4; // bit 4: cloud Shadow
  
  var mask = QA_PIXEL.bitwiseAnd(cloudBit).eq(0); // mask clouds only
  
  return image.updateMask(mask);
}

// apply cloud mask
var l8Masked_2023 = l8All_2023.map(applyCloudMask);

// select specific bands for analysis and get composite
var bandsToSelect = ['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6', 'SR_B7'];
var l8composite2023 = l8Masked_2023
.select(bandsToSelect)
.median()
.clip(aoi)
.multiply(0.0000275) // convert Landsat 8 SR to float (per USGS documentation)
.rename(['Blue', 'Green', 'Red', 'NIR', 'SWIR1', 'SWIR2']);

// define visualization parameters with corrected scale
var vizParams = {
  bands: ['Red', 'Green', 'Blue'],
  min: 0, // minimum of stretch
  max: 0.5,// maximum value of stretch
  gamma: [0.95, 1.1, 1]  // fine-tune gamma correction
};

// add layer to the map
Map.addLayer(l8composite2023, vizParams, 'L8 Composite 2023 (Cloud-Masked)');

// ----------- VIs -----------------
// Compute vegetation indices
var ndvi = l8composite2023.normalizedDifference(['NIR', 'Red']).rename('NDVI');

var evi = l8composite2023.expression(
  '2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))', {
    'NIR': l8composite2023.select('NIR'),
    'RED': l8composite2023.select('Red'),
    'BLUE': l8composite2023.select('Blue')
}).rename('EVI');

var savi = l8composite2023.expression(
  '((NIR - RED) / (NIR + RED + 0.5)) * (1.5)', {
    'NIR': l8composite2023.select('NIR'),
    'RED': l8composite2023.select('Red')
}).rename('SAVI');

var msavi = l8composite2023.expression(
  '(2 * NIR + 1 - sqrt((2 * NIR + 1) ** 2 - 8 * (NIR - RED))) / 2', {
    'NIR': l8composite2023.select('NIR'),
    'RED': l8composite2023.select('Red')
}).rename('MSAVI');

var ndmi = l8composite2023.expression(
  '(NIR - SWIR1)/(NIR + SWIR1)', {
    'NIR': l8composite2023.select('NIR'),
    'SWIR1': l8composite2023.select('SWIR1')
    }).rename('NDMI');

// add all indices as bands to the landsat composite
var l8composite2023 = l8composite2023.addBands([ndvi, evi, savi, msavi, ndmi]);

// convert all bands to Float32 to avoid error and export
l8composite2023 = l8composite2023.toFloat();

Export.image.toDrive({
  image: l8composite2023,
  description: 'L8_Composite_2023',
  folder: 'biomass_research', 
  fileNamePrefix: 'L8_Composite_2023',
  scale: 30, 
  region: aoi, 
  maxPixels: 1e13,
  crs: 'EPSG:32614' 
});

// ---------- OPEN ET --------------
// load and filter the OpenET dataset
var dataset = ee.ImageCollection('OpenET/ENSEMBLE/CONUS/GRIDMET/MONTHLY/v2_0')
  .filterDate('2023-01-01', '2023-12-31');

// compute the annual ET as the sum of the monthly ET images for the year
var et_2023 = dataset
.select('et_ensemble_mad')
.sum()
.clip(aoi);

// convert ET image to Float32 to ensure compatibility
et_2023 = et_2023.toFloat();

Export.image.toDrive({
  image: et_2023,
  description: 'ET_2023',
  folder: 'biomass_research',
  fileNamePrefix: 'ET_2023',
  scale: 30, 
  region: aoi,
  maxPixels: 1e13,
  crs: 'EPSG:32614'
});

// ------------ POLARIS SOILS -----------------

// import datasets
var bd_mean = ee.ImageCollection('projects/sat-io/open-datasets/polaris/bd_mean')
.filterBounds(aoi);
 
var clay_mean = ee.ImageCollection('projects/sat-io/open-datasets/polaris/clay_mean')
.filterBounds(aoi);
 
var ksat_mean = ee.ImageCollection('projects/sat-io/open-datasets/polaris/ksat_mean')
.filterBounds(aoi);
 
var n_mean = ee.ImageCollection('projects/sat-io/open-datasets/polaris/n_mean')
.filterBounds(aoi);
 
var om_mean = ee.ImageCollection('projects/sat-io/open-datasets/polaris/om_mean')
.filterBounds(aoi);
 
var ph_mean = ee.ImageCollection('projects/sat-io/open-datasets/polaris/ph_mean')
.filterBounds(aoi);
 
var sand_mean = ee.ImageCollection('projects/sat-io/open-datasets/polaris/sand_mean')
.filterBounds(aoi);
 
var silt_mean = ee.ImageCollection('projects/sat-io/open-datasets/polaris/silt_mean')
.filterBounds(aoi);
 
var theta_r_mean = ee.ImageCollection('projects/sat-io/open-datasets/polaris/theta_r_mean')
.filterBounds(aoi);
 
var theta_s_mean = ee.ImageCollection('projects/sat-io/open-datasets/polaris/theta_s_mean')
.filterBounds(aoi);
 
var lambda_mean = ee.ImageCollection('projects/sat-io/open-datasets/polaris/lambda_mean')
.filterBounds(aoi);
 
var hb_mean = ee.ImageCollection('projects/sat-io/open-datasets/polaris/hb_mean')
.filterBounds(aoi);
 
var alpha_mean = ee.ImageCollection('projects/sat-io/open-datasets/polaris/alpha_mean')
.filterBounds(aoi);

// select the first image from each dataset
var bd = bd_mean.first();
var clay = clay_mean.first();
var ksat = ksat_mean.first();
var n = n_mean.first();
var om = om_mean.first();
var ph = ph_mean.first();
var sand = sand_mean.first();
var silt = silt_mean.first();
var theta_r = theta_r_mean.first();
var theta_s = theta_s_mean.first();
var lambda = lambda_mean.first();
var hb = hb_mean.first();
var alpha = alpha_mean.first();

// rename for clarity
bd = bd.rename('bd');
clay = clay.rename('clay');
ksat = ksat.rename('ksat');
n = n.rename('n');
om = om.rename('om');
ph = ph.rename('ph');
sand = sand.rename('sand');
silt = silt.rename('silt');
theta_r = theta_r.rename('theta_r');
theta_s = theta_s.rename('theta_s');
lambda = lambda.rename('lambda');
hb = hb.rename('hb');
alpha = alpha.rename('alpha');

// stack all into a single multi-band image
var soil_stack = bd.addBands([
  clay, ksat, n, om, ph, sand, silt,
  theta_r, theta_s, lambda, hb, alpha
]);

Export.image.toDrive({
  image: soil_stack,
  description: 'soil_predictors_stack',
  folder: 'GEE_Exports',
  fileNamePrefix: 'soil_data',
  region: aoi,
  scale: 30,
  crs: 'EPSG:32614',
  maxPixels: 1e13
});

// ---------- DEM ----------------------

// load and clip the 10m DEM image
var dem_10m = ee.Image("USGS/3DEP/10m").clip(aoi);

// resample to 30m and reproject
var dem_30m = dem_10m
  .resample('bilinear')
  .reproject({
    crs: 'EPSG:32614',
    scale: 30
  }).toFloat();  

// derive slope and aspect, convert to Float32 too
var terrain = ee.Terrain.products(dem_30m);
var slope = terrain.select('slope').toFloat();
var aspect = terrain.select('aspect').toFloat();

// stack all topo bands and export
var terrain_stack = dem_30m.rename('elevation')
  .addBands(slope.rename('slope'))
  .addBands(aspect.rename('aspect'));

Export.image.toDrive({
  image: terrain_stack,
  description: 'DEM_Slope_Aspect_30m',
  folder: 'GEE_Exports',
  fileNamePrefix: 'terrain_30m',
  region: aoi.geometry(),
  scale: 30,
  crs: 'EPSG:32614',
  maxPixels: 1e13
});

// ------ land cover mask -----
// // snippet pulled from https://code.earthengine.google.com/?scriptPath=users%2Fsat-io%2Fawesome-gee-catalog-examples%3Aregional-landuse-landcover%2FNLCD-ANNUAL-LANDCOVER
var nlcd_landcover = ee.ImageCollection("projects/sat-io/open-datasets/USGS/ANNUAL_NLCD/LANDCOVER");
var originalClasses = [11, 12, 21, 22, 23, 24, 31, 41, 42, 43, 52, 71, 81, 82, 90, 95];
var remappedClasses = ee.List.sequence(1, originalClasses.length);
var palette = [
  '#466b9f', '#d1def8', '#dec5c5', '#d99282', '#eb0000', '#ab0000',
  '#b3ac9f', '#68ab5f', '#1c5f2c', '#b5c58f', '#ccb879', '#dfdfc2', 
  '#dcd939', '#ab6c28', '#b8d9eb', '#6c9fb8'
];

function remapImage(image) {
  var remapped = image.remap(originalClasses, remappedClasses, null);
  return remapped.copyProperties(image, ['year'])
                .set('system:time_start', image.get('system:time_start'));
}
var remappedCollection = nlcd_landcover.map(remapImage);

var forestClasses = [41, 42, 43, 52];  // Deciduous, Evergreen, Mixed Forest, Shrub
function createForestMask(image) {
  var forestMask = image.remap(forestClasses, ee.List([1, 1, 1, 1]), 0);
  return forestMask.updateMask(forestMask.neq(0));
}
var latestLandCover = nlcd_landcover.sort('system:time_start', false).first();
var forestMask = createForestMask(latestLandCover).clip(aoi);

// export
Export.image.toDrive({
  image: forestMask,
  description: 'forestMask',
  region: aoi.geometry(),
  scale: 30,
  maxPixels: 1e13,
  crs: 'EPSG:32614'
});

// to get the CCHM from Malambo and Popescu (2025), you'll have to download the files locally from NSIDC and upload them to Google Drive
// access is available here: http://doi.org/10.5067/J8DMNXTBZ22J 
