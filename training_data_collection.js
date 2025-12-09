// THIS IS INTENDED FOR GOOGLE EARTH ENGINE (GEE)

// define study area
var ecoregions = ee.FeatureCollection("RESOLVE/ECOREGIONS/2017");
var aoi = ecoregions.filter(ee.Filter.eq('ECO_NAME', 'Edwards Plateau savanna'));

Map.addLayer(aoi.style({color: 'black', width: 2, fillColor: '00000000'}), {}, 'Edwards Plateau extent');
Map.centerObject(aoi, 6);

// load the NLCD Landcover so we can mask out unneeded land cover types
// snippet pulled from https://code.earthengine.google.com/?scriptPath=users%2Fsat-io%2Fawesome-gee-catalog-examples%3Aregional-landuse-landcover%2FNLCD-ANNUAL-LANDCOVER
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

// load the MODIS burned area dataset so we can also create a burn mask
var burnArea = ee.ImageCollection("MODIS/061/MCD64A1")
  .filterDate('2001-01-01', '2023-12-31')
  .filterBounds(aoi)
  .select('BurnDate');

// convert each burn image to binary (burned = 1, unburned = 0)
var burnedMask = burnArea.map(function(img) {
  return img.gt(0).rename('burned');
}).sum().gt(0);

// load NPP partitioned dataset from RAP
// code snippet from: https://rangelands.app/support/61-processing-rap-data-in-google-earth-engine 
var RAP_npp = ee.ImageCollection("projects/rap-data-365417/assets/npp-partitioned-v3")
  .filterDate('2001-01-01', '2023-12-31')
  .filterBounds(aoi);
  
print("Available Bands:", RAP_npp.first().bandNames()); // list band names, we are interested in the woody ones

// load MAT dataset from RAP 
var mat = ee.ImageCollection("projects/rap-data-365417/assets/gridmet-MAT");

// mask out No Data (65535) for tree and shrub NPP bands
function maskNoData(img) {
  var tree = img.select('treNPP');
  var shrub = img.select('shrNPP');
  var combinedMask = tree.neq(65535).and(shrub.neq(65535));
  return img.updateMask(combinedMask);
}
var cleanedNPP = RAP_npp.map(maskNoData);

// create separate collections for tree and shrub NPP
// note from future Hailey - we will end up only using the tree collection
var treeNPP = cleanedNPP.map(function(img) {
  return img.select('treNPP').copyProperties(img, img.propertyNames());
});
var shrubNPP = cleanedNPP.map(function(img) {
  return img.select('shrNPP').copyProperties(img, img.propertyNames());
});

// next, we will begin tracking regrowth (accumulated NPP) --------------------------------------

// set processing parameters
var yearStart = 2001;
var yearEnd = 2023;
var years = ee.List.sequence(yearStart, yearEnd);

// function to process each year (including burn reset)
function processYear(year) {
  var start = ee.Date.fromYMD(ee.Number(year).int(), 1, 1);
  var end = start.advance(1, 'year');

  // get annual NPP images for trees and shrubs
  var treeNPP_year = ee.Image(treeNPP.filterDate(start, end).first());
  var shrubNPP_year = ee.Image(shrubNPP.filterDate(start, end).first());

  // filter the monthly burn product for the current year
  var filteredBurn = burnArea.filterDate(start, end);

  // create a burn year image:
  var burnYearImage = filteredBurn.map(function(img) {
  var yr = ee.Date(img.get('system:time_start')).get('year'); 
  return img.select('BurnDate')
    .gt(0)  // only keep pixels that burned
    .multiply(yr)  // replace 1-366 with the actual year
    .rename('BurnYear')
    .toShort();  // cast to Short for consistency
}).reduce(ee.Reducer.max()).toShort();

  
  // unmask burnYearImage so unburned pixels get 0
  burnYearImage = burnYearImage.unmask(0);
  
  // reset regrowth if the pixel burned in the current year
  // wrap the year as an image constant for the equality check
  var treeRegrowth = treeNPP_year.where(burnYearImage.eq(ee.Image.constant(year)), 0);
  var shrubRegrowth = shrubNPP_year.where(burnYearImage.eq(ee.Image.constant(year)), 0);

  // combine the two bands into a regrowth image
  var regrowth = ee.Image.cat([
    treeRegrowth.rename("treeNPP").toFloat(),
    shrubRegrowth.rename("shrubNPP").toFloat()
  ]);

  // return a dictionary with the per-pixel burn year and regrowth for this year
  return ee.Dictionary({
    burnYear: burnYearImage,
    regrowth: regrowth
  });
}

// process each year and accumulate regrowth over time
var yearlyResults = years.map(processYear);

function accumulateRegrowth(current, prev) {
  prev = ee.Image(prev);  // cumulative regrowth so far
  var currDict = ee.Dictionary(current);
  var regrowth = ee.Image(currDict.get('regrowth'));  // current year regrowth
  var burnYearCurr = ee.Image(currDict.get('burnYear'));
  
  // create a mask that resets if:
  // 1. a fire occurred (burnYearCurr > 0), or
  // 2. the current year's regrowth is zero 
  var resetMask = burnYearCurr.gt(0).or(regrowth.eq(0));
  
  // for pixels where resetMask is true, ignore the previous accumulation
  var resetPrev = prev.where(resetMask, 0);
  
  // otherwise, add the current regrowth to the previous accumulation
  var newCumulative = resetPrev.add(regrowth);
  return newCumulative;
}

var initialCumulative = ee.Image.constant([0, 0]).toFloat().rename(["treeNPP", "shrubNPP"]);
var yearlyList = ee.List(yearlyResults);
var perPixelRegrowth = ee.Image(yearlyList.iterate(accumulateRegrowth, initialCumulative));

// clip the final cumulative regrowth image to the study area
var clippedRegrowth = perPixelRegrowth.clip(aoi);

// unit conversion from NPP (carbon) to biomass (lbs/acre) --------------------
// conversions are from scripts at: https://gee-community-catalog.org/projects/rap/#earth-engine-asset-paths

// compute an average MAT over the study period to calculate fANPP.
var avgMAT = mat.mean();
var fANPP = avgMAT.multiply(0.0129).add(0.171);
// Convert the final cumulative regrowth to biomass using the conversion factors:
//   - Multiply by 0.0001 (NPP scalar)
//   - Multiply by 2.20462 (kg C to lbs C)
//   - Multiply by 4046.86 (m² to acres)
//   - Multiply by fANPP (fraction aboveground)
//   - Multiply by 2.1276 (C to biomass)

var biomassClippedRegrowth = clippedRegrowth.multiply(0.0001)
    .multiply(2.20462)
    .multiply(4046.86)
    .multiply(fANPP)
    .multiply(2.1276)
    .rename(["treeBiomass", "shrubBiomass"]);

// apply fire mask to regrowth image

// create a fire mask: for each year, extract the burnYear image and compute the maximum
// this tells you whether a pixel ever burned during the study period.
var burnYearCollection = ee.ImageCollection(yearlyResults.map(function(dict) {
  return ee.Image(ee.Dictionary(dict).get('burnYear'));
}));
var maxBurnYear = burnYearCollection.max();

// create a mask where pixels that ever burned have a value > 0
var fireMask = maxBurnYear.gt(0);

// apply the fire mask to the biomass image so that only burned pixels show biomass regrowth
var biomassFinal = biomassClippedRegrowth.updateMask(fireMask);

// display biomass layers
var visParamsTree = {min: 0, max: 20, palette: ['white', 'green']};
var visParamsShrub = {min: 0, max: 20, palette: ['white', 'brown']};

Map.addLayer(biomassFinal.select('treeBiomass'), visParamsTree, "Tree Biomass (2023)");
Map.addLayer(biomassFinal.select('shrubBiomass'), visParamsShrub, "Shrub Biomass (2023)");

// now sample a random subset of pixels from the biomass image
var samplePoints = biomassFinal.sample({
  region: aoi,
  scale: 30,
  numPixels: 100000,
  seed: 42,
  geometries: true
}).limit(1000);  // cap at 5,000 to avoid the error due to memory constraints in GEE

print("Sampled points:", samplePoints);

// export the sampled points as a shapefile
Export.table.toDrive({
  collection: samplePoints,
  description: "Biomass_Sampled",
  fileFormat: "SHP"
});
